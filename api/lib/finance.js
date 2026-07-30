'use strict';
const logger = require('./logger');
const { getTenantSetting } = require('./tenantSettings');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');
const { uuidv4 } = require('./id');
const { pool } = require('./db');
const { assertWritable } = require('./periodLock');
const { dateOnlyInTimeZone } = require('./dates');
const { ensureInvoiceForPayment } = require('./financialDocuments');

// Logs a payment status change to payment_audit_log table.
async function logPaymentAudit(paymentId, action, oldStatus, newStatus, amount, subscriberId, actor, tenantId = DEFAULT_TENANT, db = pool, strict = false) {
  try {
    await db.query(
      `INSERT INTO payment_audit_log
         (id, tenant_id, payment_id, action, old_status, new_status, amount, subscriber_id, actor)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuidv4(), tenantId, paymentId, action, oldStatus || null, newStatus || null,
       amount ?? null, subscriberId || null, actor || 'system']
    );
  } catch (e) {
    if (strict) throw e;
    logger.warn('[audit] logPaymentAudit error:', e.message);
  }
}

// Generalised financial audit (Top20 #6): any money-moving action across
// payments / expenses / refunds / payroll / accounting periods.
async function logFinancialAudit({ entityType, entityId, action, oldData, newData, amount, actor, tenantId = 'tenant-default', db = pool, strict = false }) {
  try {
    await db.query(
      `INSERT INTO financial_audit_log (id, tenant_id, entity_type, entity_id, action, old_json, new_json, amount, actor)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuidv4(), tenantId, entityType, entityId || null, action,
       oldData ? JSON.stringify(oldData) : null, newData ? JSON.stringify(newData) : null,
       amount != null ? amount : null, actor || 'system']
    );
  } catch (e) {
    if (strict) throw e;
    logger.warn('[audit] logFinancialAudit error:', e.message);
  }
}

// Chart of accounts:
//  1100 = نقدية وبنوك      (Cash / Bank)
//  4100 = إيرادات كورسات   (Course Revenue)
//  4200 = إيرادات استشارات (Consultation Revenue)
//  4300 = إيرادات شهادات   (Certificate Revenue)
//  4900 = إيرادات أخرى    (Other Revenue)
//  5100 = رواتب موظفين    (Staff Salaries)
//  2100 = مستحقات الرواتب  (Accrued Salaries Payable)
async function postJournalEntry(refType, refId, entryDate, description, lines, postedBy, db = pool, tenantId = 'tenant-default', scope = {}) {
  const date = (entryDate instanceof Date ? entryDate.toISOString() : String(entryDate || '')).slice(0, 10);
  const normalizedLines = Array.isArray(lines) ? lines.map(line => ({
    account_code: String(line?.account_code || '').trim(),
    account_name: String(line?.account_name || '').trim(),
    debit: Number(line?.debit || 0),
    credit: Number(line?.credit || 0),
  })) : [];
  const invalidLine = normalizedLines.some(line =>
    !line.account_code || !line.account_name
    || !Number.isFinite(line.debit) || !Number.isFinite(line.credit)
    || line.debit < 0 || line.credit < 0
    || (line.debit > 0 && line.credit > 0)
    || (line.debit === 0 && line.credit === 0)
    || Math.max(line.debit, line.credit) > 100000000
  );
  const totalDebit = Number(normalizedLines.reduce((sum, line) => sum + line.debit, 0).toFixed(2));
  const totalCredit = Number(normalizedLines.reduce((sum, line) => sum + line.credit, 0).toFixed(2));
  if (!refType || !tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || normalizedLines.length < 2 || invalidLine || totalDebit <= 0
    || Math.abs(totalDebit - totalCredit) >= 0.01) {
    logger.warn('[journal] rejected invalid or unbalanced journal entry', { refType, refId, tenantId });
    return null;
  }
  const entryId = uuidv4();
  // When no external connection is supplied, wrap the header + all lines in our
  // OWN transaction so a mid-loop failure can never leave a half-written,
  // unbalanced journal entry in the ledger. When a caller injects its own
  // connection (db !== pool), it owns the transaction — we just use it.
  const ownTx = (db === pool);
  let conn = db;
  try {
    if (ownTx) { conn = await pool.getConnection(); await conn.beginTransaction(); }
    await assertWritable(date, conn, tenantId);
    await conn.query(
      `INSERT INTO journal_entries
         (id, tenant_id, branch, branch_id, ref_type, ref_id, entry_date, description, total_debit, total_credit, posted_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [entryId, tenantId, scope.branch || null, scope.branchId || null, refType, refId || null,
       date, description || null, totalDebit, totalCredit, postedBy || 'system']
    );
    const accounts = [...new Map(normalizedLines.map(line => [line.account_code, line])).values()];
    for (const line of accounts) {
      const prefix = String(line.account_code || '').slice(0, 1);
      const accountType = prefix === '1' ? 'asset' : prefix === '2' ? 'liability'
        : prefix === '3' ? 'equity' : prefix === '4' ? 'revenue' : 'expense';
      await conn.query(
        `INSERT IGNORE INTO tenant_chart_of_accounts (tenant_id, code, name, type)
         VALUES (?,?,?,?)`,
        [tenantId, line.account_code, line.account_name, accountType]
      );
    }
    const [activeAccounts] = await conn.query(
      `SELECT code,is_active FROM tenant_chart_of_accounts
        WHERE tenant_id=? AND code IN (${accounts.map(() => '?').join(',')})`,
      [tenantId, ...accounts.map(line => line.account_code)]
    );
    const activeCodes = new Set(
      activeAccounts.filter(account => account.is_active !== 0).map(account => String(account.code))
    );
    const unavailable = accounts.map(line => line.account_code).filter(code => !activeCodes.has(code));
    if (unavailable.length) throw new Error(`Inactive or unavailable ledger account(s): ${unavailable.join(', ')}`);
    for (const line of normalizedLines) {
      await conn.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_code, account_name, debit, credit)
         VALUES (?,?,?,?,?,?)`,
        [uuidv4(), entryId, line.account_code, line.account_name, Number(line.debit) || 0, Number(line.credit) || 0]
      );
    }
    if (ownTx) await conn.commit();
    return entryId;
  } catch (e) {
    if (ownTx && conn) { try { await conn.rollback(); } catch { /* already dead */ } }
    logger.warn('[journal] postJournalEntry error:', e.message);
    return null;
  } finally {
    if (ownTx && conn && conn.release) conn.release();
  }
}

// Returns [accountCode, accountName] for a given payment type.
function _paymentAccountCode(paymentType) {
  const map = {
    COURSE:       ['4100', 'إيرادات كورسات'],
    CONSULTATION: ['4200', 'إيرادات استشارات'],
    CERTIFICATE:  ['4300', 'إيرادات شهادات'],
  };
  return map[paymentType] || ['4900', 'إيرادات أخرى'];
}

// Expense category → expense account (debit-normal, 5xxx range).
// Keep in sync with the ENUM on expenses.category.
const EXPENSE_ACCOUNTS = {
  SALARIES:    ['5100', 'رواتب موظفين'],
  RENT:        ['5200', 'إيجارات'],
  UTILITIES:   ['5300', 'مرافق وخدمات'],
  SOFTWARE:    ['5400', 'برمجيات واشتراكات'],
  MARKETING:   ['5500', 'تسويق وإعلانات'],
  EQUIPMENT:   ['5600', 'معدات وأجهزة'],
  MAINTENANCE: ['5700', 'صيانة'],
  TRAVEL:      ['5800', 'انتقالات وسفر'],
  OTHER:       ['5900', 'مصروفات أخرى'],
};
function _expenseAccountCode(category) {
  return EXPENSE_ACCOUNTS[String(category || 'OTHER').toUpperCase()] || EXPENSE_ACCOUNTS.OTHER;
}

// ── Currency normalisation for the journal ───────────────────────────────────
// The journal (and every report built on it: P&L, trial balance) must be in a
// single currency. Rates come from the tenant-scoped content setting keys
// 'exchange.sar_to_egp' / 'exchange.usd_to_egp' (auto-refreshed daily in
// server.js). Static values are kept for read-only display compatibility, but
// foreign-currency money movements fail closed unless a fresh tenant snapshot
// is available.
const _FX_FALLBACK = { SAR: 13, USD: 48 };
const _fxCache = new Map();
function invalidateFxCache(tenantId = null) { if (tenantId) _fxCache.delete(tenantId); else _fxCache.clear(); }
async function getFxSnapshot(tenantId = DEFAULT_TENANT) {
  const cached = _fxCache.get(tenantId);
  if (cached?.rates && Date.now() - cached.ts < 10 * 60 * 1000) return cached;
  let sar = _FX_FALLBACK.SAR, usd = _FX_FALLBACK.USD;
  let source = 'static-fallback';
  let updatedAt = null;
  try {
    const content = await getTenantSetting('content', { tenantId, fallback: {} });
    const configuredSar = parseFloat(content['exchange.sar_to_egp']);
    const configuredUsd = parseFloat(content['exchange.usd_to_egp']);
    if (configuredSar > 0 && configuredUsd > 0) {
      sar = configuredSar;
      usd = configuredUsd;
      source = String(content['exchange.source'] || 'tenant-config').slice(0, 80);
      updatedAt = content['exchange.updated_at'] || null;
    }
  } catch (_) { /* keep fallbacks */ }
  const rates = { EGP: 1, SAR: sar, USD: usd };
  const snapshot = { rates, source, updatedAt, ts: Date.now() };
  _fxCache.set(tenantId, snapshot);
  return snapshot;
}
async function getFxToEgp(tenantId = DEFAULT_TENANT) {
  return (await getFxSnapshot(tenantId)).rates;
}

function isFxSnapshotUsable(snapshot, currency, now = Date.now()) {
  const cur = String(currency || 'EGP').toUpperCase();
  if (cur === 'EGP') return true;
  if (!['SAR', 'USD'].includes(cur) || snapshot?.source === 'static-fallback') return false;
  const updatedAt = new Date(snapshot?.updatedAt || '').getTime();
  const maxAgeMs = Math.max(1, Number(process.env.FX_MAX_AGE_HOURS || 48)) * 3600000;
  return Number.isFinite(Number(snapshot?.rates?.[cur]))
    && Number(snapshot.rates[cur]) > 0
    && Number.isFinite(updatedAt)
    && updatedAt <= now
    && now - updatedAt <= maxAgeMs;
}

// Converts an amount to EGP for journal posting. Returns a 2dp number.
async function toEgp(amount, currency, tenantId = DEFAULT_TENANT) {
  const amt = Number(amount) || 0;
  const cur = String(currency || 'EGP').toUpperCase();
  if (cur === 'EGP') return amt;
  if (!['SAR', 'USD'].includes(cur)) throw new Error(`Unsupported currency: ${cur}`);
  const snapshot = await getFxSnapshot(tenantId);
  if (!isFxSnapshotUsable(snapshot, cur)) throw new Error(`Fresh FX snapshot unavailable for ${cur}`);
  const rate = Number(snapshot.rates[cur]);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`FX rate unavailable for ${cur}`);
  return parseFloat((amt * rate).toFixed(2));
}

// Ledger-first helper (Top20 #13): every paid payment must post a double-entry
// journal (cash 1100 debit / revenue credit), normalised to EGP. Returns the
// journal id on success or null on failure so transaction-owning callers can
// rollback money-moving writes instead of committing an unposted payment.
async function postPaymentJournal({ paymentId, amount, currency, payType, date, actor, tenantId = 'tenant-default', branch = null, branchId = null }, db = pool) {
  try {
    const [accCode, accName] = _paymentAccountCode((payType || 'OTHER').toUpperCase());
    const fx = await getFxSnapshot(tenantId);
    const rates = fx.rates;
    const normalizedCurrency = String(currency || 'EGP').toUpperCase();
    if (!['EGP', 'SAR', 'USD'].includes(normalizedCurrency)) {
      throw new Error(`Unsupported payment currency: ${normalizedCurrency}`);
    }
    if (!isFxSnapshotUsable(fx, normalizedCurrency)) {
      throw new Error(`Fresh FX snapshot unavailable for ${normalizedCurrency}`);
    }
    const appliedRate = Number(rates[normalizedCurrency]);
    if (!Number.isFinite(appliedRate) || appliedRate <= 0) {
      throw new Error(`FX rate unavailable for ${normalizedCurrency}`);
    }
    const amtEgp = parseFloat(((Number(amount) || 0) * appliedRate).toFixed(2));
    if (amtEgp <= 0) return null;
    if ((!branch || !branchId) && paymentId) {
      const [paymentRows] = await db.query(
        'SELECT branch, branch_id FROM payments WHERE id=? AND tenant_id=? LIMIT 1',
        [paymentId, tenantId]
      );
      const paymentScope = Array.isArray(paymentRows) ? paymentRows[0] : null;
      branch = branch || paymentScope?.branch || null;
      branchId = branchId || paymentScope?.branch_id || null;
    }
    const journalId = await postJournalEntry('payment', paymentId, date || dateOnlyInTimeZone(),
      `دفعة ${amount} ${currency || 'EGP'} (= ${amtEgp} EGP) — ${payType || 'OTHER'}`,
      [
        { account_code: '1100', account_name: 'نقدية وبنوك', debit: amtEgp, credit: 0 },
        { account_code: accCode, account_name: accName, debit: 0, credit: amtEgp },
      ],
      actor || 'system', db, tenantId, { branch, branchId }
    );
    if (!journalId) return null;
    await db.query(
      'UPDATE payments SET fx_rate_to_egp=?,amount_egp=?,fx_source=?,fx_applied_at=COALESCE(fx_applied_at,NOW()) WHERE id=? AND tenant_id=?',
      [appliedRate, amtEgp, fx.source, paymentId, tenantId]
    );
    await ensureInvoiceForPayment(db, {
      id: paymentId,
      tenant_id: tenantId,
      branch_id: branchId,
      amount,
      currency: normalizedCurrency,
      date: date || dateOnlyInTimeZone(),
    }, actor || 'system');
    return journalId;
  } catch (e) { logger.warn('[finance] postPaymentJournal error:', e.message); return null; }
}

// Expense double-entry, mirror of postPaymentJournal. sign=+1 posts the expense
// (expense-account debit / cash 1100 credit); sign=-1 posts the reversal (used
// on edit and on soft-delete so the ledger stays == the expenses table).
// Amount is normalised to EGP. Lifted out of the (dead, shadowed) core/content.js
// into the shared finance lib so the LIVE expense handlers can post to the ledger.
async function postExpenseJournal(expense, sign, actor, db = pool, tenantId = expense.tenant_id || 'tenant-default') {
  try {
    const fx = await getFxSnapshot(tenantId);
    const rates = fx.rates;
    const normalizedCurrency = String(expense.currency || 'EGP').toUpperCase();
    const appliedRate = rates[normalizedCurrency] || 1;
    // A reversal must use the exact EGP snapshot from the original posting.
    // Revaluing it with today's FX rate would leave an artificial balance in
    // the ledger after editing or deleting a foreign-currency expense.
    const snapshottedEgp = Number(expense.amount_egp);
    const amt = sign < 0 && Number.isFinite(snapshottedEgp) && snapshottedEgp > 0
      ? snapshottedEgp
      : parseFloat(((Number(expense.amount) || 0) * appliedRate).toFixed(2));
    if (!amt) return null;
    const [accCode, accName] = _expenseAccountCode(expense.category);
    const dateStr = String(expense.date || new Date().toISOString()).slice(0, 10);
    const label = sign > 0
      ? `مصروف ${expense.amount} ${expense.currency || 'EGP'} (= ${amt} EGP) — ${expense.description || accName}`
      : `عكس مصروف ${expense.amount} ${expense.currency || 'EGP'} (= ${amt} EGP) — ${expense.description || accName}`;
    const lines = sign > 0
      ? [
          { account_code: accCode, account_name: accName, debit: amt, credit: 0 },
          { account_code: '1100', account_name: 'نقدية وبنوك', debit: 0, credit: amt },
        ]
      : [
          { account_code: '1100', account_name: 'نقدية وبنوك', debit: amt, credit: 0 },
          { account_code: accCode, account_name: accName, debit: 0, credit: amt },
        ];
    const journalId = await postJournalEntry(
      sign > 0 ? 'expense' : 'expense_reversal',
      expense.id,
      dateStr,
      label,
      lines,
      actor || 'system',
      db,
      tenantId,
      { branchId: expense.branch_id || null }
    );
    if (journalId && sign > 0) await db.query(
      'UPDATE expenses SET fx_rate_to_egp=?,amount_egp=?,fx_source=?,fx_applied_at=COALESCE(fx_applied_at,NOW()) WHERE id=? AND tenant_id=?',
      [appliedRate, amt, fx.source, expense.id, tenantId]
    );
    return journalId;
  } catch (e) { logger.warn('[finance] postExpenseJournal error:', e.message); return null; }
}

module.exports = {
  logPaymentAudit,
  logFinancialAudit,
  postJournalEntry,
  postPaymentJournal,
  postExpenseJournal,
  _paymentAccountCode,
  _expenseAccountCode,
  toEgp,
  getFxToEgp,
  getFxSnapshot,
  isFxSnapshotUsable,
  invalidateFxCache,
};
