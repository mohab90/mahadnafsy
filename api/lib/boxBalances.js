'use strict';

// «الخزائن»: each payment box's CURRENT BALANCE — what is in it now — kept apart from what came in today or yesterday
// (25 Oct 2026). «كل وسيلة دفع وفيها كام … رصيد حالي غير دخل اليوم … ونقدر نصفّر العداد ونعدّل الرصيد العام».
//
// A box's balance is its opening amount plus every paid payment that came into it after its baseline (refunds are negative
// rows in the box they left from, so they net). With no baseline yet the balance counts every payment ever made to it.
//   «تصفير»          takes the box to 0 from now: the opening goes to 0 and the baseline to this moment — what was in it
//                    is written to the history as the amount taken out.
//   «تعديل الرصيد»   sets the box to a number the desk counted: the opening absorbs the difference.
//   «الرصيد العام»   is the sum of the boxes in a currency plus a general adjustment (the box named GENERAL below); setting it
//                    moves only that adjustment, so no single box is rewritten to make a total come out.
// Every change is a row in box_balance_events with the balance before and after, who and why. The payments themselves are
// never touched. Boxes are the institute's: a branch's own view has no balances.

const { uuidv4 } = require('./id');
const { canonicalChannel } = require('./paymentChannels');

const GENERAL = '__general__';
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { statusCode, code });

const PAID = "(p.status = 'paid' OR p.status IS NULL)";

/** Payments' sums by (box, currency), merged from the raw spellings; `since` limits them to payments entered after it. */
async function sumsByBox(db, { tenantId, since = null }) {
  const [rows] = await db.query(
    `SELECT p.payment_method AS method, p.currency, SUM(p.amount) AS total
       FROM payments p
      WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND ${PAID}${since ? ' AND p.created_at > ?' : ''}
      GROUP BY p.payment_method, p.currency`,
    since ? [tenantId, since] : [tenantId]);
  const sums = new Map();
  for (const row of rows) {
    const key = `${canonicalChannel(row.method)}|${row.currency || 'EGP'}`;
    sums.set(key, round2((sums.get(key) || 0) + Number(row.total)));
  }
  return sums;
}

/**
 * Every box's current balance: Map `${box}|${currency}` → { balance, opening, since }.
 * Boxes that have payments, boxes that have been reset or adjusted, and the general adjustment.
 */
async function currentBalances(db, { tenantId, lock = false }) {
  const [stored] = await db.query(
    `SELECT method, currency, opening_amount, baseline_at FROM box_balances WHERE tenant_id = ?${lock ? ' FOR UPDATE' : ''}`, [tenantId]);
  const baselines = new Map(stored.map(row => [`${row.method}|${row.currency}`, row]));
  const everything = await sumsByBox(db, { tenantId });
  // A box with a baseline counts only what came in after it: one grouped query per distinct baseline.
  const sinceCache = new Map();
  const balances = new Map();
  const keys = new Set([...everything.keys(), ...baselines.keys()]);
  for (const key of keys) {
    const base = baselines.get(key);
    let sums = everything;
    if (base?.baseline_at) {
      const stamp = new Date(base.baseline_at).getTime();
      if (!sinceCache.has(stamp)) sinceCache.set(stamp, await sumsByBox(db, { tenantId, since: base.baseline_at }));
      sums = sinceCache.get(stamp);
    }
    const opening = round2(base?.opening_amount);
    balances.set(key, { balance: round2(opening + (key.startsWith(`${GENERAL}|`) ? 0 : (sums.get(key) || 0))), opening, since: base?.baseline_at || null });
  }
  return balances;
}

const totalOf = (balances, currency) => round2([...balances].filter(([key]) => key.endsWith(`|${currency}`)).reduce((sum, [, value]) => sum + value.balance, 0));

async function logEvent(db, { tenantId, method, currency, kind, before, after, note, actor }) {
  await db.query(
    `INSERT INTO box_balance_events (id, tenant_id, method, currency, kind, balance_before, balance_after, note, actor)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [uuidv4(), tenantId, method, currency, kind, before, after, String(note || '').trim().slice(0, 500) || null, actor ? String(actor).slice(0, 255) : null]);
}

const cleanCurrency = value => {
  const currency = String(value || 'EGP').toUpperCase();
  if (!['EGP', 'SAR', 'USD'].includes(currency)) throw fail('العملة لازم تكون EGP أو SAR أو USD', 'BOX_CURRENCY');
  return currency;
};

/** Writes one box's opening and baseline (creating its row). */
async function writeBox(db, { tenantId, method, currency, opening, baselineNow, actor }) {
  await db.query(
    `INSERT INTO box_balances (tenant_id, method, currency, opening_amount, baseline_at, updated_by)
     VALUES (?,?,?,?, ${baselineNow ? 'NOW()' : 'NULL'}, ?)
     ON DUPLICATE KEY UPDATE opening_amount=VALUES(opening_amount), ${baselineNow ? 'baseline_at=NOW(),' : ''} updated_by=VALUES(updated_by)`,
    [tenantId, method, currency, opening, actor ? String(actor).slice(0, 255) : null]);
}

/** «تصفير»: the box starts again from 0, from this moment. */
async function resetBox(db, { tenantId, method, currency, note = '', actor = null }) {
  const cur = cleanCurrency(currency);
  const box = String(method || '').trim();
  if (!box) throw fail('اختار الخزنة', 'BOX_REQUIRED');
  const balances = await currentBalances(db, { tenantId, lock: true });
  const before = balances.get(`${box}|${cur}`)?.balance ?? 0;
  await writeBox(db, { tenantId, method: box, currency: cur, opening: 0, baselineNow: true, actor });
  await logEvent(db, { tenantId, method: box, currency: cur, kind: 'reset', before, after: 0, note, actor });
  return { before, after: 0 };
}

/** «تعديل الرصيد»: the box is set to the amount counted. */
async function setBoxBalance(db, { tenantId, method, currency, amount, note = '', actor = null }) {
  const cur = cleanCurrency(currency);
  const box = String(method || '').trim();
  const target = round2(amount);
  if (!box) throw fail('اختار الخزنة', 'BOX_REQUIRED');
  if (!Number.isFinite(Number(amount)) || Math.abs(target) > 1e11) throw fail('اكتب رصيد صحيح', 'BOX_AMOUNT');
  const balances = await currentBalances(db, { tenantId, lock: true });
  const current = balances.get(`${box}|${cur}`) || { balance: 0, opening: 0 };
  await writeBox(db, { tenantId, method: box, currency: cur, opening: round2(current.opening + target - current.balance), baselineNow: false, actor });
  await logEvent(db, { tenantId, method: box, currency: cur, kind: 'set_balance', before: current.balance, after: target, note, actor });
  return { before: current.balance, after: target };
}

/** «تعديل الرصيد العام»: the total in a currency is set; only the general adjustment moves. */
async function setTotalBalance(db, { tenantId, currency, amount, note = '', actor = null }) {
  const cur = cleanCurrency(currency);
  const target = round2(amount);
  if (!Number.isFinite(Number(amount)) || Math.abs(target) > 1e11) throw fail('اكتب رصيد صحيح', 'BOX_AMOUNT');
  const balances = await currentBalances(db, { tenantId, lock: true });
  const total = totalOf(balances, cur);
  const general = balances.get(`${GENERAL}|${cur}`) || { opening: 0 };
  await writeBox(db, { tenantId, method: GENERAL, currency: cur, opening: round2(general.opening + target - total), baselineNow: false, actor });
  await logEvent(db, { tenantId, method: GENERAL, currency: cur, kind: 'set_total', before: total, after: target, note, actor });
  return { before: total, after: target };
}

/** «تصفير الكل»: every box in the currency, and the general adjustment, start again from 0. */
async function resetAll(db, { tenantId, currency, note = '', actor = null }) {
  const cur = cleanCurrency(currency);
  const balances = await currentBalances(db, { tenantId, lock: true });
  const before = totalOf(balances, cur);
  const boxes = [...balances.keys()].filter(key => key.endsWith(`|${cur}`)).map(key => key.slice(0, -(cur.length + 1)));
  for (const box of boxes) await writeBox(db, { tenantId, method: box, currency: cur, opening: 0, baselineNow: true, actor });
  await logEvent(db, { tenantId, method: '*', currency: cur, kind: 'reset_all', before, after: 0, note, actor });
  return { before, after: 0, boxes: boxes.length };
}

async function recentEvents(db, { tenantId, limit = 30 }) {
  const [rows] = await db.query(
    `SELECT id, method, currency, kind, balance_before, balance_after, note, actor, created_at
       FROM box_balance_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`, [tenantId, limit]);
  return rows.map(row => ({
    id: row.id, method: row.method === GENERAL ? 'تسوية عامة' : row.method === '*' ? 'كل الخزائن' : row.method, currency: row.currency, kind: row.kind,
    before: Number(row.balance_before), after: Number(row.balance_after), note: row.note || '', actor: row.actor || '', at: row.created_at,
  }));
}

module.exports = { GENERAL, currentBalances, recentEvents, resetAll, resetBox, setBoxBalance, setTotalBalance, sumsByBox, totalOf };
