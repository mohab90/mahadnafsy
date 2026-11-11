'use strict';

// Payroll arithmetic, extracted verbatim from routes/hr/payroll.js so it can be
// tested. It was inline in the route, which is why the money-critical part of HR
// had almost no coverage: nothing could exercise it without standing up the
// whole request path and a database.
//
// Every operation and its ordering is preserved exactly as it ran in the route —
// this is a move, not a rewrite, so a payslip computed before and after is
// identical.

/**
 * Compute one staff member's payroll line.
 *
 * @param {object} emp        staff/salary row (allowances, deductions)
 * @param {object} ctx
 *  - salaryFx            FX factor applied to fixed amounts
 *  - baseSalary          already FX-converted base (the whole month's)
 *  - paidDays            the days of the month paid, at most 30 (lib/payrollProration.js): fewer for someone who joined or left during it; the basic salary and the
 *                        allowances are pro-rated by paidDays/30, a day's pay (absences, lateness) stays a thirtieth of the whole salary
 *  - workdayMinutes      from HR policy
 *  - attendance          { absent_days, unexcused_absent_days, late_minutes, present_days, unpaid_leave_days }
 *  - advanceDeduction    salary advances being recovered
 *  - instructorEarnings  teaching fees
 *  - bonus, deduction    manual adjustments
 */
const PAY_MONTH_DAYS = 30;
// 4 Nov 2026, «الغياب بدون إذن بخصم يومين»: a day missed without permission costs two days of pay; a day missed with permission (marked 'excused') costs one.
const UNEXCUSED_ABSENCE_DAYS = 2;
// 11 Nov 2026, «اه يخصم نص يوم من المرتب»: a half day costs half a day's pay.
const HALF_DAY_CHARGED_DAYS = 0.5;
// The days of pay one attendance_logs row (alias a) costs: an ABSENT day costs the figure HR typed on it when there is one, else one day with permission and
// UNEXCUSED_ABSENCE_DAYS without; a HALF_DAY with no leave behind it costs the figure typed on it (a cheaper one included) or half a day. A half day written by an
// approved leave (leave_id) keeps that leave's own rule: a permission costs nothing in pay, an unpaid half day is charged through unpaid_leave_days. Summed by the
// payroll run and by the month sheet so the two cannot disagree; the payslip is the run's.
const ABSENCE_CHARGED_DAYS_SQL = `CASE WHEN a.status='ABSENT' THEN IF(a.deduction_days > 0, a.deduction_days, IF(a.permit_used='excused', 1, ${UNEXCUSED_ABSENCE_DAYS}))
  WHEN a.status='HALF_DAY' AND a.leave_id IS NULL THEN IF(a.deduction_days > 0, a.deduction_days, ${HALF_DAY_CHARGED_DAYS}) ELSE 0 END`;
// The days a row costs through the lateness tiers (deduction_days): an absence and a half day with no leave have their own figure above, so it is not counted twice.
const LATE_DEDUCTION_DAYS_SQL = `CASE WHEN a.status='ABSENT' OR (a.status='HALF_DAY' AND a.leave_id IS NULL) THEN 0 ELSE a.deduction_days END`;

// The days a month counts as attended for one attendance_logs row (alias a): a day worked in the office, late or remotely is one, a half day half. The payroll run and
// the attendance summary (the month sheet's «حضور») sum this, so the sheet and the payslip's attendance days are the same number.
const PRESENT_DAYS_SQL = `CASE WHEN a.status IN ('PRESENT','LATE','REMOTE') THEN 1 WHEN a.status='HALF_DAY' THEN 0.5 ELSE 0 END`;

function computePayrollLine(emp = {}, ctx = {}) {
  const {
    salaryFx = 1,
    baseSalary = 0,
    paidDays = PAY_MONTH_DAYS,
    workdayMinutes = 480,
    attendance = {},
    advanceDeduction = 0,
    instructorEarnings = 0,
    commission = 0,
    bonus = 0,
    deduction = 0,
  } = ctx;

  const paidFactor = Math.min(PAY_MONTH_DAYS, Math.max(0, Number(paidDays))) / PAY_MONTH_DAYS;
  const housing    = (parseFloat(emp.housing_allowance) || 0) * salaryFx * paidFactor;
  const transport  = (parseFloat(emp.transport_allowance) || 0) * salaryFx * paidFactor;
  const food       = (parseFloat(emp.food_allowance) || 0) * salaryFx * paidFactor;
  const otherFixed = (parseFloat(emp.other_fixed) || 0) * salaryFx * paidFactor;
  const dedSocial  = (parseFloat(emp.deduction_social_insurance) || 0) * salaryFx;
  const dedTax     = (parseFloat(emp.deduction_tax) || 0) * salaryFx;
  const totalAllowances = housing + transport + food + otherFixed;

  const unpaidLeaveDays = Number(attendance.unpaid_leave_days) || 0;
  const absentDays = (Number(attendance.absent_days) || 0) + unpaidLeaveDays;
  const lateMins   = parseInt(attendance.late_minutes) || 0;
  // absent_days counts every ABSENT day; unexcused_absent_days is the part of them nobody gave permission for. What they cost in days is absent_charged_days
  // (ABSENCE_CHARGED_DAYS_SQL): the figure HR typed on the day when there is one, else UNEXCUSED_ABSENCE_DAYS without permission and one with. Unpaid leave costs a day each.
  const unexcusedAbsentDays = Math.min(Number(attendance.unexcused_absent_days) || 0, Number(attendance.absent_days) || 0);
  const absenceChargedDays = (Number(attendance.absent_charged_days) || 0) + unpaidLeaveDays;

  // 3 Nov 2026, «احسب دايما الراتب على 30 يوم»: the day's pay is the month's salary over thirty, whatever the month's length or its working days. A constant
  // also leaves no stored value that could turn the daily rate into Infinity (a DECIMAL "0.00" once did, and every payslip of the run came out NaN). The
  // policy's work_days_per_month only counts the days a month is expected to have a record (the unmarked-days warning). The minutes of a day are still guarded.
  const safeWorkMinutes = Number(workdayMinutes) > 0 ? Number(workdayMinutes) : 480;

  const dailyRate  = baseSalary / PAY_MONTH_DAYS;
  const minuteRate = baseSalary / (PAY_MONTH_DAYS * safeWorkMinutes);
  const absenceDeduction = dailyRate * absenceChargedDays;
  // Days the policy's tiers judged (¼, ½, a whole day) cost that fraction of
  // the daily rate; minutes on older rows are still charged per minute.
  const lateDeductionDays = Number(attendance.late_deduction_days) || 0;
  const lateDeduction    = minuteRate * lateMins + dailyRate * lateDeductionDays;
  // 8 Nov 2026: a weekly day off that was worked is overtime, paid at the day's rate times what HR set it at (1, 1.5, 2 … days; migration 382).
  const overtimeDays = Number(attendance.overtime_days) || 0;
  const overtimePay = dailyRate * overtimeDays;

  // 10 Nov 2026, «ميحسبش من نفسه حاجه تانيه الا لما يتم الادخال يدوي»: payroll works out no sales commission of its own. What an employee earns over the
  // salary is the month's bonus (the bonus plan's rounds and levels, saved for approval) and what was typed by hand; both arrive as `bonus`. `commission`
  // is zero unless the owner switched the automatic commission on for this employee (lib/payrollCommission.js), and then it is the amount that rule gives.
  // The basic salary of the days he belonged to the month; a full month is the whole of it.
  const paidBase = baseSalary * paidFactor;
  const grossSalary = paidBase + totalAllowances + commission + instructorEarnings + bonus + overtimePay;

  // An advance is recovered only as far as the salary can carry it.
  //
  // Everything else here is owed whatever the month looked like: the statutory
  // withholdings, the days not worked, the manual adjustment. The advance is
  // different — it is money already handed over, and recovering it depends on
  // there being a salary left to take it from.
  //
  // Net used to be floored at zero with the whole advance inside the total, so
  // a large advance against a month of absence paid the employee nothing and
  // recorded the advance as fully recovered. Both the journal — credit 1300,
  // employee advances receivable — and the settlement that follows the run take
  // that figure at face value, so the business wrote off a debt it had not
  // collected. Splitting applied from carried leaves net identical in every
  // case, since it was already floored at zero, and makes the recorded figure
  // the one that actually happened.
  const otherDeductions = dedSocial + dedTax + absenceDeduction + lateDeduction + deduction;
  const roomForAdvance = Math.max(0, grossSalary - otherDeductions);
  const advanceApplied = Math.min(advanceDeduction, roomForAdvance);
  const advanceCarried = advanceDeduction - advanceApplied;

  const totalDeductions = otherDeductions + advanceApplied;
  const netSalary = Math.max(0, grossSalary - totalDeductions);

  return {
    housing, transport, food, otherFixed, totalAllowances, paidBase, paidDays: paidFactor * PAY_MONTH_DAYS,
    dedSocial, dedTax,
    absentDays, unexcusedAbsentDays, absenceChargedDays, lateMins, lateDeductionDays, dailyRate, minuteRate, absenceDeduction, lateDeduction, overtimeDays, overtimePay,
    // advanceDeduction is what was due this month; advanceApplied is what the
    // salary could actually absorb, and is the figure the books must use.
    advanceDeduction, advanceApplied, advanceCarried,
    commission, instructorEarnings, bonus, deduction,
    grossSalary, totalDeductions, netSalary,
    // Not used in the arithmetic above, but written into the payslip's
    // calculation_details so it reconciles. It was in scope when this lived
    // inline in the route; after extraction the route referenced it as a free
    // variable and every payroll run threw a ReferenceError.
    unpaidLeaveDays,
  };
}

module.exports = { computePayrollLine, PAY_MONTH_DAYS, UNEXCUSED_ABSENCE_DAYS, HALF_DAY_CHARGED_DAYS, ABSENCE_CHARGED_DAYS_SQL, LATE_DEDUCTION_DAYS_SQL, PRESENT_DAYS_SQL };
