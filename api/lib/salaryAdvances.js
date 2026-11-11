'use strict';

// How a payroll run recovers salary advances (migration 385, 11 Nov 2026, the owner: «موافق لعمود السلف»).
//
// The run reads every DISBURSED advance whose deduction month is this month or earlier and takes what is still owed (amount - recovered_amount), oldest first, only as
// far as the salary carries it. CALCULATE writes nothing to an advance: the split is kept on the payslip (calculation_details.advances) and recovered_amount grows only
// when the run is PAID, from that same split — so a recalculation, or a run that is cancelled, leaves every advance as it was, and one advance cannot be taken twice.

const cents = value => Math.round((Number(value) || 0) * 100);
const fromCents = value => value / 100;

/** Every DISBURSED advance of these employees due in (year, month) or earlier, oldest first. */
async function dueAdvances(db, tenantId, staffIds, year, month) {
  if (!staffIds.length) return [];
  const [rows] = await db.query(
    `SELECT id, staff_id, amount, recovered_amount, currency, deduct_month, deduct_year
       FROM salary_advances
      WHERE tenant_id=? AND staff_id IN (?) AND status='DISBURSED'
        AND deduct_year IS NOT NULL AND deduct_month IS NOT NULL
        AND deduct_year*12 + deduct_month <= ?
      ORDER BY deduct_year, deduct_month, disbursed_at, created_at, id`,
    [tenantId, staffIds, year * 12 + month]);
  return rows;
}

/** What is still owed on an advance, in its own currency (never below zero). */
const owedOf = advance => Math.max(0, fromCents(cents(advance.amount) - cents(advance.recovered_amount)));

/** The employee's total still owed, in EGP, over the advances dueAdvances returned for him. */
function owedEgp(advances, fx = {}) {
  return advances.reduce((sum, advance) => sum + owedOf(advance) * Number(fx[String(advance.currency || 'EGP').toUpperCase()] || 1), 0);
}

/**
 * Spread what the salary could absorb (applied, in EGP) over one employee's advances, oldest first.
 * @returns {{ lines: object[], owedBefore: number, owedAfter: number }} lines are in EGP and in the advance's own currency; owed* in EGP
 */
function allocateAdvances(advances, appliedEgp, fx = {}) {
  let left = cents(appliedEgp);
  const lines = [];
  let owedBefore = 0;
  let owedAfter = 0;
  for (const advance of advances) {
    const currency = String(advance.currency || 'EGP').toUpperCase();
    const rate = Number(fx[currency] || 1);
    const owed = owedOf(advance);
    const owedInEgp = cents(owed * rate);
    const takenEgp = Math.min(left, owedInEgp);
    left -= takenEgp;
    // The whole of what was owed is recorded as exactly that, so a rate that does not divide evenly leaves no cent behind on a settled advance.
    const taken = takenEgp >= owedInEgp ? owed : Math.round(fromCents(takenEgp) / rate * 100) / 100;
    owedBefore += owedInEgp;
    owedAfter += owedInEgp - takenEgp;
    lines.push({
      id: advance.id, currency, amount: Number(advance.amount), recoveredBefore: Number(advance.recovered_amount) || 0,
      dueMonth: advance.deduct_month, dueYear: advance.deduct_year,
      owedBefore: owed, applied: taken, appliedEgp: fromCents(takenEgp), owedAfter: Math.max(0, Math.round((owed - taken) * 100) / 100),
    });
  }
  return { lines, owedBefore: fromCents(owedBefore), owedAfter: fromCents(owedAfter) };
}

class AdvancesChangedError extends Error {
  constructor(advanceId) {
    super('A salary advance in this run was recovered by another run since it was calculated');
    this.code = 'PAYROLL_ADVANCES_CHANGED';
    this.advanceId = advanceId;
  }
}

/**
 * The run is being PAID: add each payslip's recorded split to the advances. Inside the run's transaction. An advance that no longer has what the payslip took from
 * it (another run was paid first) refuses the payment — the payslip would otherwise have taken from the employee what he no longer owes; cancel the run and
 * calculate it again.
 * @returns {Promise<{ recovered: number, settled: number }>} advances touched, and advances now fully recovered
 */
async function recoverAdvancesOfPaidRun(db, tenantId, runId) {
  const [items] = await db.query(
    `SELECT calculation_details FROM payroll_items WHERE tenant_id=? AND payroll_run_id=?`, [tenantId, runId]);
  let recovered = 0;
  let settled = 0;
  for (const item of items) {
    let details = item.calculation_details;
    try { details = typeof details === 'string' ? JSON.parse(details) : (details || {}); } catch { details = {}; }
    for (const line of Array.isArray(details.advances) ? details.advances : []) {
      if (!(cents(line.applied) > 0)) continue;
      const [[advance]] = await db.query(
        `SELECT id, amount, recovered_amount, status FROM salary_advances WHERE id=? AND tenant_id=? FOR UPDATE`, [line.id, tenantId]);
      if (!advance || advance.status !== 'DISBURSED' || cents(line.applied) > cents(advance.amount) - cents(advance.recovered_amount)) throw new AdvancesChangedError(line.id);
      const nowRecovered = cents(advance.recovered_amount) + cents(line.applied);
      const done = nowRecovered >= cents(advance.amount);
      await db.query(
        `UPDATE salary_advances SET recovered_amount=?, status=IF(?, 'DEDUCTED', status), deducted_payroll_run_id=IF(?, ?, deducted_payroll_run_id)
          WHERE id=? AND tenant_id=?`,
        [fromCents(Math.min(nowRecovered, cents(advance.amount))), done ? 1 : 0, done ? 1 : 0, runId, line.id, tenantId]);
      recovered += 1;
      if (done) settled += 1;
    }
  }
  return { recovered, settled };
}

module.exports = { dueAdvances, owedOf, owedEgp, allocateAdvances, recoverAdvancesOfPaidRun, AdvancesChangedError };
