'use strict';
const { uuidv4 } = require('./id');
const { pool } = require('./db');

// Logs a payment status change to payment_audit_log table.
async function logPaymentAudit(paymentId, action, oldStatus, newStatus, amount, subscriberId, actor) {
  try {
    await pool.query(
      `INSERT INTO payment_audit_log (id, payment_id, action, old_status, new_status, amount, subscriber_id, actor)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuidv4(), paymentId, action, oldStatus || null, newStatus || null, amount || null, subscriberId || null, actor || 'system']
    );
  } catch (e) { console.warn('[audit] logPaymentAudit error:', e.message); }
}

// Chart of accounts:
//  1100 = نقدية وبنوك      (Cash / Bank)
//  4100 = إيرادات كورسات   (Course Revenue)
//  4200 = إيرادات استشارات (Consultation Revenue)
//  4300 = إيرادات شهادات   (Certificate Revenue)
//  4900 = إيرادات أخرى    (Other Revenue)
//  5100 = رواتب موظفين    (Staff Salaries)
//  2100 = مستحقات الرواتب  (Accrued Salaries Payable)
async function postJournalEntry(refType, refId, entryDate, description, lines, postedBy) {
  try {
    const entryId = uuidv4();
    const totalDebit  = lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    await pool.query(
      `INSERT INTO journal_entries (id, ref_type, ref_id, entry_date, description, total_debit, total_credit, posted_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [entryId, refType, refId || null, entryDate, description || null, totalDebit, totalCredit, postedBy || 'system']
    );
    for (const line of lines) {
      await pool.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_code, account_name, debit, credit)
         VALUES (?,?,?,?,?,?)`,
        [uuidv4(), entryId, line.account_code, line.account_name, Number(line.debit) || 0, Number(line.credit) || 0]
      );
    }
    return entryId;
  } catch (e) { console.warn('[journal] postJournalEntry error:', e.message); return null; }
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
// single currency. Rates come from site_config content keys
// 'exchange.sar_to_egp' / 'exchange.usd_to_egp' (auto-refreshed daily in
// server.js). Falls back to static defaults if config is missing so a posting
// never silently mixes currencies again.
const _FX_FALLBACK = { SAR: 13, USD: 48 };
let _fxCache = { rates: null, ts: 0 };
async function getFxToEgp() {
  if (_fxCache.rates && Date.now() - _fxCache.ts < 10 * 60 * 1000) return _fxCache.rates;
  let sar = _FX_FALLBACK.SAR, usd = _FX_FALLBACK.USD;
  try {
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'content'");
    const content = rows[0]?.value ? JSON.parse(rows[0].value) : {};
    sar = parseFloat(content['exchange.sar_to_egp']) || sar;
    usd = parseFloat(content['exchange.usd_to_egp']) || usd;
  } catch (_) { /* keep fallbacks */ }
  _fxCache = { rates: { EGP: 1, SAR: sar, USD: usd }, ts: Date.now() };
  return _fxCache.rates;
}

// Converts an amount to EGP for journal posting. Returns a 2dp number.
async function toEgp(amount, currency) {
  const amt = Number(amount) || 0;
  const cur = String(currency || 'EGP').toUpperCase();
  if (cur === 'EGP') return amt;
  const rates = await getFxToEgp();
  return parseFloat((amt * (rates[cur] || 1)).toFixed(2));
}

module.exports = { logPaymentAudit, postJournalEntry, _paymentAccountCode, _expenseAccountCode, toEgp, getFxToEgp };
