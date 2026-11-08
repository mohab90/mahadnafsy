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
 * @param {object} emp        staff/salary row (allowances, deductions, commission_rate)
 * @param {object} ctx
 *  - salaryFx            FX factor applied to fixed amounts
 *  - baseSalary          already FX-converted base
 *  - workdayMinutes      from HR policy
 *  - attendance          { absent_days, unexcused_absent_days, late_minutes, present_days, unpaid_leave_days }
 *  - crmCommission       { amt, cnt } | null — authoritative when cnt > 0
 *  - totalSales          EGP sales used for the flat-rate fallback
 *  - advanceDeduction    salary advances being recovered
 *  - instructorEarnings  teaching fees
 *  - bonus, deduction    manual adjustments
 */
const PAY_MONTH_DAYS = 30;
// 4 Nov 2026, «الغياب بدون إذن بخصم يومين»: a day missed without permission costs two days of pay; a day missed with permission (marked 'excused') costs one.
const UNEXCUSED_ABSENCE_DAYS = 2;

function computePayrollLine(emp = {}, ctx = {}) {
  const {
    salaryFx = 1,
    baseSalary = 0,
    workdayMinutes = 480,
    attendance = {},
    crmCommission = null,
    totalSales = 0,
    advanceDeduction = 0,
    instructorEarnings = 0,
    bonus = 0,
    deduction = 0,
  } = ctx;

  const housing    = (parseFloat(emp.housing_allowance) || 0) * salaryFx;
  const transport  = (parseFloat(emp.transport_allowance) || 0) * salaryFx;
  const food       = (parseFloat(emp.food_allowance) || 0) * salaryFx;
  const otherFixed = (parseFloat(emp.other_fixed) || 0) * salaryFx;
  const dedSocial  = (parseFloat(emp.deduction_social_insurance) || 0) * salaryFx;
  const dedTax     = (parseFloat(emp.deduction_tax) || 0) * salaryFx;
  const totalAllowances = housing + transport + food + otherFixed;

  const unpaidLeaveDays = Number(attendance.unpaid_leave_days) || 0;
  const absentDays = (Number(attendance.absent_days) || 0) + unpaidLeaveDays;
  const lateMins   = parseInt(attendance.late_minutes) || 0;
  // absent_days counts every ABSENT day; unexcused_absent_days is the part of them nobody gave permission for, and each of those costs the extra day.
  const unexcusedAbsentDays = Math.min(Number(attendance.unexcused_absent_days) || 0, Number(attendance.absent_days) || 0);
  const absenceChargedDays = absentDays + unexcusedAbsentDays * (UNEXCUSED_ABSENCE_DAYS - 1);

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

  // crm_commissions is authoritative when it has rows; the percentage of sales
  // is only a fallback, so a rep is never paid on both bases at once.
  let commission, commissionCount, commissionSource;
  if (crmCommission && crmCommission.cnt > 0) {
    commission = crmCommission.amt;
    commissionCount = crmCommission.cnt;
    commissionSource = 'crm_commissions';
  } else {
    // A target earner (staff.commission_type = 'TARGET') is paid by the month's bonus, never by a percentage of what they collected: a rate left on the staff
    // row from before must not turn their sales into a commission.
    const rate = emp.commission_type === 'TARGET' ? 0 : (parseFloat(emp.commission_rate) || 0);
    commission = totalSales * (rate / 100);
    commissionCount = null;
    commissionSource = 'flat_rate';
  }

  const grossSalary = baseSalary + totalAllowances + commission + instructorEarnings + bonus + overtimePay;

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
    housing, transport, food, otherFixed, totalAllowances,
    dedSocial, dedTax,
    absentDays, unexcusedAbsentDays, absenceChargedDays, lateMins, lateDeductionDays, dailyRate, minuteRate, absenceDeduction, lateDeduction, overtimeDays, overtimePay,
    commission, commissionCount, commissionSource,
    // advanceDeduction is what was due this month; advanceApplied is what the
    // salary could actually absorb, and is the figure the books must use.
    advanceDeduction, advanceApplied, advanceCarried,
    instructorEarnings, bonus, deduction,
    grossSalary, totalDeductions, netSalary,
    // Not used in the arithmetic above, but written into the payslip's
    // calculation_details so it reconciles. They were in scope when this lived
    // inline in the route; after extraction the route referenced them as free
    // variables and every payroll run threw a ReferenceError.
    totalSales, unpaidLeaveDays,
  };
}

module.exports = { computePayrollLine, PAY_MONTH_DAYS, UNEXCUSED_ABSENCE_DAYS };
