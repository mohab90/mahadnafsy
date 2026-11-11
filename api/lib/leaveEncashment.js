'use strict';

// «بدل رصيد الإجازات» (11 Nov 2026, the owner: the leave balance does not carry over — at the end of the year the days each employee has left are turned into money at his
// salary). For a year: every active employee with his entitlement, what he used, what is left, the day's pay and the amount (remaining days x a thirtieth of the monthly
// salary). On confirmation it writes ONE employee_bonuses row per employee (type bonus, source LEAVE_ENCASHMENT, PENDING so a second person approves it like every bonus),
// for the month HR chooses. Running it again for the same year updates the rows still pending and never touches an approved or rejected one. The new year's balance is
// the full entitlement whatever was paid: nothing here carries a day over (lib/leaveBalance.js counts a calendar year only).

const { getEffectiveHrPolicy } = require('./hrPolicy');
const { leaveBalances } = require('./leaveBalance');
const { dayPayEgp } = require('./payrollSalary');
const { getFxToEgp } = require('./finance');

const SOURCE = 'LEAVE_ENCASHMENT';
const round2 = value => Math.round((Number(value) || 0) * 100) / 100;

/** @returns {{ year: number, month: number, payYear: number }} or throws a 400 */
function periodOf({ year, month, payYear }) {
  const y = Number(year);
  const m = month === undefined || month === null || month === '' ? 12 : Number(month);
  const py = payYear === undefined || payYear === null || payYear === '' ? y : Number(payYear);
  if (!(Number.isInteger(y) && y >= 2020 && y <= 2100)) throw Object.assign(new Error('اختار السنة'), { statusCode: 400 });
  if (!(Number.isInteger(m) && m >= 1 && m <= 12)) throw Object.assign(new Error('اختار شهر الصرف'), { statusCode: 400 });
  if (!(Number.isInteger(py) && py >= y && py <= y + 1)) throw Object.assign(new Error('سنة الصرف لازم تكون نفس السنة أو اللي بعدها'), { statusCode: 400 });
  return { year: y, month: m, payYear: py };
}

/**
 * Every active employee with the year's balance and what it is worth. An employee with no basic salary is listed with no day rate and no amount.
 * @returns {Promise<{ year, month, payYear, entitlement: number, rows: object[], total: number }>}
 */
async function encashmentList(db, { tenantId, year, month, payYear }) {
  const entitlement = Number((await getEffectiveHrPolicy(db, tenantId, `${year}-12-31`)).annual_leave_days) || 21;
  const [staff] = await db.query(
    `SELECT id, name, role FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL ORDER BY name`, [tenantId]);
  const balances = await leaveBalances(db, { tenantId, year, entitlement });
  const fx = await getFxToEgp(tenantId);
  const [existing] = await db.query(
    `SELECT staff_id, status, amount FROM employee_bonuses WHERE tenant_id=? AND source=? AND JSON_UNQUOTE(JSON_EXTRACT(calc_json, '$.year'))=?`,
    [tenantId, SOURCE, String(year)]);
  const saved = new Map(existing.map(row => [row.staff_id, row]));
  const rows = [];
  for (const person of staff) {
    const balance = balances.get(person.id) || { entitlement, used: 0, remaining: entitlement };
    const dayRate = await dayPayEgp(db, tenantId, person.id, payYear, month, fx);
    const remaining = Number(balance.remaining) || 0;
    const amount = dayRate > 0 ? round2(remaining * dayRate) : 0;
    const row = saved.get(person.id);
    rows.push({
      staffId: person.id, name: person.name, role: person.role,
      entitlement: Number(balance.entitlement) || entitlement, used: Number(balance.used) || 0, remaining,
      dayRate: dayRate > 0 ? round2(dayRate) : null, amount,
      noSalary: !(dayRate > 0),
      saved: row ? { status: row.status, amount: Number(row.amount) } : null,
    });
  }
  return { year, month, payYear, entitlement, rows, total: round2(rows.reduce((sum, row) => sum + row.amount, 0)) };
}

/**
 * Writes the year's encashment as one PENDING bonus per employee, inside the caller's transaction. A row already APPROVED (or REJECTED) is kept and reported; a pending one is
 * updated (its amount, its month); an employee whose amount is now nothing has his pending row removed. `skipStaffIds`: people the caller may not write for (his own).
 */
async function saveEncashment(db, { tenantId, year, month, payYear, actorId = null, skipStaffIds = [] }) {
  const list = await encashmentList(db, { tenantId, year, month, payYear });
  const skip = new Set(skipStaffIds.map(String));
  const written = []; const updated = []; const kept = []; const cleared = []; const skipped = []; const noSalary = [];
  for (const row of list.rows) {
    if (skip.has(String(row.staffId))) { skipped.push({ staffId: row.staffId, name: row.name }); continue; }
    if (row.noSalary && row.remaining > 0) noSalary.push({ staffId: row.staffId, name: row.name });
    const [[current]] = await db.query(
      `SELECT id, status, amount FROM employee_bonuses
        WHERE tenant_id=? AND staff_id=? AND source=? AND JSON_UNQUOTE(JSON_EXTRACT(calc_json, '$.year'))=?
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [tenantId, row.staffId, SOURCE, String(year)]);
    if (current && current.status !== 'PENDING') { kept.push({ staffId: row.staffId, name: row.name, status: current.status, amount: Number(current.amount), now: row.amount }); continue; }
    if (!(row.amount > 0)) {
      if (current) { await db.query('DELETE FROM employee_bonuses WHERE id=? AND tenant_id=?', [current.id, tenantId]); cleared.push(row.staffId); }
      continue;
    }
    const reason = `بدل رصيد الإجازات سنة ${year}: باقي ${row.remaining} يوم × ${row.dayRate} ج.م (يوم المرتب)`;
    const calc = JSON.stringify({ year, entitlement: row.entitlement, used: row.used, remaining: row.remaining, dayRate: row.dayRate });
    if (current) {
      await db.query('UPDATE employee_bonuses SET amount=?, reason=?, calc_json=?, for_month=?, for_year=? WHERE id=? AND tenant_id=?',
        [row.amount, reason, calc, month, payYear, current.id, tenantId]);
      updated.push({ staffId: row.staffId, name: row.name, amount: row.amount });
    } else {
      await db.query(
        `INSERT INTO employee_bonuses (staff_id, type, amount, status, currency, reason, for_month, for_year, created_by, tenant_id, source, calc_json)
         VALUES (?, 'bonus', ?, 'PENDING', 'EGP', ?, ?, ?, ?, ?, ?, ?)`,
        [row.staffId, row.amount, reason, month, payYear, actorId, tenantId, SOURCE, calc]);
      written.push({ staffId: row.staffId, name: row.name, amount: row.amount });
    }
  }
  return { ...list, written, updated, kept, cleared, skipped, noSalary };
}

module.exports = { SOURCE, periodOf, encashmentList, saveEncashment };
