'use strict';

// «زر سحب من الرصيد ونحدد التوجيه المحاسبي له … سحب شخصي مهاب أو وليد لأنهم شركاء … وجدول بالأرصدة اللي سحبها مهاب واللي سحبها وليد من كل الخزن» (28 Oct 2026).
//
// A withdrawal takes money out of one box and says where it went — the accounting direction:
//   partner   a partner's personal drawing (مهاب, وليد): debit the partner's drawings account (equity, 3310 / 3320, made in the chart on first use)
//   expense   an expense: debit the expense account chosen from the chart
//   other     any other account of the chart
//   transfer  to another box of the same currency: nothing is posted — both boxes are in 1100 «نقدية وبنوك» — one loses, the other gains
// Everything but a transfer is one balanced entry in EGP: debit the account it was directed to, credit 1100. A withdrawal is never deleted;
// voiding it marks it and posts the reversing entry. The box balance (lib/boxBalances.js) counts the withdrawals after its baseline.

const { uuidv4 } = require('./id');
const finance = require('./finance');
const { applyAlias, loadBoxAliases } = require('./boxAliases');
const { GENERAL, currentBalances, logEvent } = require('./boxBalances');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { statusCode, code });
const CASH = { code: '1100', name: 'نقدية وبنوك' };

/** The partners who may draw, and the equity account each one's drawings go to. */
const PARTNERS = [
  { key: 'mohab', name: 'مهاب', account: '3310', accountName: 'مسحوبات شخصية — مهاب' },
  { key: 'walid', name: 'وليد', account: '3320', accountName: 'مسحوبات شخصية — وليد' },
];
const partnerOf = key => PARTNERS.find(partner => partner.key === key) || null;
const KINDS = ['partner', 'expense', 'other', 'transfer'];

async function chartAccount(db, tenantId, code) {
  const [[row]] = await db.query(
    'SELECT code, name, type, is_active FROM tenant_chart_of_accounts WHERE tenant_id = ? AND code = ? LIMIT 1', [tenantId, code]);
  return row || null;
}

async function ensurePartnerAccount(db, tenantId, partner) {
  await db.query(
    `INSERT INTO tenant_chart_of_accounts (tenant_id, code, name, type, is_active) VALUES (?,?,?, 'equity', 1)
     ON DUPLICATE KEY UPDATE is_active = 1`,
    [tenantId, partner.account, partner.accountName]);
  return { code: partner.account, name: partner.accountName };
}

/**
 * The account a withdrawal is directed to, from what the caller chose — or null for a transfer.
 */
async function directionOf(db, tenantId, input) {
  if (input.kind === 'transfer') return null;
  if (input.kind === 'partner') {
    const partner = partnerOf(input.partner);
    if (!partner) throw fail('اختار الشريك: مهاب أو وليد', 'WITHDRAW_PARTNER');
    return ensurePartnerAccount(db, tenantId, partner);
  }
  const code = String(input.accountCode || '').trim();
  if (!code) throw fail('اختار الحساب اللي هيتسجل عليه السحب', 'WITHDRAW_ACCOUNT');
  if (code === CASH.code) throw fail('مينفعش السحب يتسجل على حساب النقدية نفسه', 'WITHDRAW_ACCOUNT');
  const account = await chartAccount(db, tenantId, code);
  if (!account || !account.is_active) throw fail('الحساب ده مش موجود في دليل الحسابات', 'WITHDRAW_ACCOUNT');
  if (input.kind === 'expense' && account.type !== 'expense') throw fail('المصروف لازم يتسجل على حساب مصروفات', 'WITHDRAW_ACCOUNT');
  return { code: account.code, name: account.name };
}

/**
 * Take money out of a box. Runs inside the caller's transaction; resolves { id, before, after, journalId }.
 * input: { method, currency, amount, kind, partner?, toMethod?, accountCode?, note?, date?, force? }
 */
async function withdraw(db, { tenantId, actor = null, today, input }) {
  const kind = KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) throw fail('اختار نوع السحب', 'WITHDRAW_KIND');
  const currency = String(input.currency || 'EGP').toUpperCase();
  if (!['EGP', 'SAR', 'USD'].includes(currency)) throw fail('العملة لازم تكون EGP أو SAR أو USD', 'BOX_CURRENCY');
  const amount = round2(input.amount);
  if (!(amount > 0) || amount > 1e9) throw fail('اكتب مبلغ صحيح', 'WITHDRAW_AMOUNT');
  const aliases = await loadBoxAliases(db, tenantId);
  const method = applyAlias(String(input.method || '').trim(), aliases);
  if (!method || method === GENERAL) throw fail('اختار الخزنة', 'BOX_REQUIRED');
  const toMethod = kind === 'transfer' ? applyAlias(String(input.toMethod || '').trim(), aliases) : null;
  if (kind === 'transfer' && (!toMethod || toMethod === method)) throw fail('اختار خزنة تانية للتحويل', 'WITHDRAW_TARGET');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? String(input.date) : today;
  const note = String(input.note || '').trim().slice(0, 500) || null;

  const balances = await currentBalances(db, { tenantId, lock: true });
  const before = balances.get(`${method}|${currency}`)?.balance ?? 0;
  if (amount > before + 0.001 && !input.force) {
    throw fail(`الرصيد (${before}) أقل من المبلغ المسحوب. لو الرصيد غلط عدّله الأول، أو أكّد السحب.`, 'BOX_INSUFFICIENT', 409);
  }
  const direction = await directionOf(db, tenantId, { ...input, kind });
  const id = uuidv4();
  let journalId = null;
  if (direction) {
    const egp = await finance.toEgp(amount, currency, tenantId);
    journalId = await finance.postJournalEntry('box_withdrawal', id, date, `سحب من خزنة ${method} — ${direction.name}${note ? ` — ${note}` : ''}`,
      [
        { account_code: direction.code, account_name: direction.name, debit: egp, credit: 0 },
        { account_code: CASH.code, account_name: CASH.name, debit: 0, credit: egp },
      ], actor || 'system', db, tenantId);
    if (!journalId) throw fail('تعذر تسجيل القيد المحاسبي للسحب', 'WITHDRAW_JOURNAL', 500);
  }
  await db.query(
    `INSERT INTO box_withdrawals
       (id, tenant_id, method, currency, amount, kind, partner, to_method, account_code, account_name, journal_entry_id, note, withdrawn_on, actor)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, tenantId, method, currency, amount, kind, kind === 'partner' ? input.partner : null, toMethod, direction?.code || null, direction?.name || null,
      journalId, note, date, actor ? String(actor).slice(0, 255) : null]);
  await logEvent(db, {
    tenantId, method, currency, kind: kind === 'transfer' ? 'transfer' : 'withdraw', before, after: round2(before - amount),
    note: `${kind === 'partner' ? `سحب شخصي — ${partnerOf(input.partner).name}` : kind === 'transfer' ? `تحويل إلى ${toMethod}` : direction.name}${note ? ` — ${note}` : ''}`, actor,
  });
  return { id, before, after: round2(before - amount), journalId };
}

/** Cancel a withdrawal: marked, and its entry reversed. Resolves { id, before, after } of the box. */
async function voidWithdrawal(db, { tenantId, id, actor = null, today }) {
  const [[row]] = await db.query('SELECT * FROM box_withdrawals WHERE tenant_id = ? AND id = ? LIMIT 1 FOR UPDATE', [tenantId, id]);
  if (!row) throw fail('السحب ده مش موجود', 'WITHDRAW_MISSING', 404);
  if (row.voided_at) throw fail('السحب ده اتلغى قبل كده', 'WITHDRAW_VOIDED', 409);
  if (row.journal_entry_id) {
    const egp = await finance.toEgp(Number(row.amount), row.currency, tenantId);
    const reversed = await finance.postJournalEntry('box_withdrawal_void', row.id, today, `إلغاء سحب من خزنة ${row.method} — ${row.account_name}`,
      [
        { account_code: CASH.code, account_name: CASH.name, debit: egp, credit: 0 },
        { account_code: row.account_code, account_name: row.account_name, debit: 0, credit: egp },
      ], actor || 'system', db, tenantId);
    if (!reversed) throw fail('تعذر تسجيل قيد الإلغاء', 'WITHDRAW_JOURNAL', 500);
  }
  const balances = await currentBalances(db, { tenantId, lock: true });
  const before = balances.get(`${row.method}|${row.currency}`)?.balance ?? 0;
  await db.query('UPDATE box_withdrawals SET voided_at = NOW(), voided_by = ? WHERE tenant_id = ? AND id = ?', [actor ? String(actor).slice(0, 255) : null, tenantId, id]);
  const after = round2(before + Number(row.amount));
  await logEvent(db, { tenantId, method: row.method, currency: row.currency, kind: 'void_withdrawal', before, after, note: `إلغاء سحب ${row.amount}`, actor });
  return { id, before, after };
}

/**
 * The withdrawals of a period, newest first, and what each partner took: per partner, in total and in each box, per currency.
 * `kind` limits the rows (the partners' table asks for 'partner'); voided ones are listed, marked, and left out of every total.
 */
async function listWithdrawals(db, { tenantId, from = null, to = null, kind = null, partner = null, limit = 500 }) {
  const where = ['tenant_id = ?'];
  const params = [tenantId];
  if (from) { where.push('withdrawn_on >= ?'); params.push(from); }
  if (to) { where.push('withdrawn_on <= ?'); params.push(to); }
  if (KINDS.includes(kind)) { where.push('kind = ?'); params.push(kind); }
  if (partnerOf(partner)) { where.push('partner = ?'); params.push(partner); }
  const [rows] = await db.query(
    `SELECT id, method, currency, amount, kind, partner, to_method, account_code, account_name, note, withdrawn_on, actor, voided_at, created_at
       FROM box_withdrawals WHERE ${where.join(' AND ')} ORDER BY withdrawn_on DESC, created_at DESC LIMIT ?`, [...params, Math.min(2000, Math.max(1, limit))]);
  const aliases = await loadBoxAliases(db, tenantId);
  const list = rows.map(row => ({
    id: row.id, box: applyAlias(row.method, aliases), currency: row.currency, amount: Number(row.amount), kind: row.kind, partner: row.partner,
    partnerName: partnerOf(row.partner)?.name || null, toBox: row.to_method ? applyAlias(row.to_method, aliases) : null,
    account: row.account_code ? `${row.account_code} ${row.account_name || ''}`.trim() : null, note: row.note || '',
    date: typeof row.withdrawn_on === 'string' ? row.withdrawn_on : new Date(row.withdrawn_on).toISOString().slice(0, 10),
    actor: row.actor || '', voided: Boolean(row.voided_at), at: row.created_at,
  }));
  const partners = PARTNERS.map(partnerInfo => {
    const mine = list.filter(row => row.kind === 'partner' && row.partner === partnerInfo.key && !row.voided);
    const totals = {};
    const boxes = new Map();
    for (const row of mine) {
      totals[row.currency] = round2((totals[row.currency] || 0) + row.amount);
      const key = `${row.box}|${row.currency}`;
      boxes.set(key, round2((boxes.get(key) || 0) + row.amount));
    }
    return {
      key: partnerInfo.key, name: partnerInfo.name, account: partnerInfo.account, totals,
      boxes: [...boxes].map(([key, total]) => ({ box: key.slice(0, key.lastIndexOf('|')), currency: key.slice(key.lastIndexOf('|') + 1), total })).sort((a, b) => b.total - a.total),
      count: mine.length,
    };
  });
  return { rows: list, partners };
}

module.exports = { KINDS, PARTNERS, listWithdrawals, partnerOf, voidWithdrawal, withdraw };
