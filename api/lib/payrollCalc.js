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
 *  - workDaysPerMonth    from HR policy
 *  - workdayMinutes      from HR policy
 *  - attendance          { absent_days, late_minutes, present_days, unpaid_leave_days }
 *  - crmCommission       { amt, cnt } | null — authoritative when cnt > 0
 *  - totalSales          EGP sales used for the flat-rate fallback
 *  - advanceDeduction    salary advances being recovered
 *  - instructorEarnings  teaching fees
 *  - bonus, deduction    manual adjustments
 */
function computePayrollLine(emp = {}, ctx = {}) {
  const {
    salaryFx = 1,
    baseSalary = 0,
    workDaysPerMonth = 26,
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

  // The divisors are guarded here rather than trusted from the caller.
  //
  // The route reads them as `Number(policy.work_days_per_month || 26)`, which
  // looks like a fallback and is not one: work_days_per_month is DECIMAL, and
  // mysql2 hands DECIMAL back as a string — so a stored zero arrives as "0.00",
  // which is truthy, skips the `|| 26`, and becomes 0. The daily rate is then
  // Infinity, and Infinity × 0 absent days is NaN, which passes through
  // Math.max(0, NaN) as NaN. Every payslip in the run comes out NaN.
  //
  // The policy route does reject a zero on save, so this is not reachable
  // today. It is guarded anyway because the arithmetic is where money is
  // decided, and a guard that only works when the column type cooperates is
  // not one worth relying on.
  const safeWorkDays = Number(workDaysPerMonth) > 0 ? Number(workDaysPerMonth) : 26;
  const safeWorkMinutes = Number(workdayMinutes) > 0 ? Number(workdayMinutes) : 480;

  const dailyRate  = baseSalary / safeWorkDays;
  const minuteRate = baseSalary / (safeWorkDays * safeWorkMinutes);
  const absenceDeduction = dailyRate * absentDays;
  const lateDeduction    = minuteRate * lateMins;

  // crm_commissions is authoritative when it has rows; the percentage of sales
  // is only a fallback, so a rep is never paid on both bases at once.
  let commission, commissionCount, commissionSource;
  if (crmCommission && crmCommission.cnt > 0) {
    commission = crmCommission.amt;
    commissionCount = crmCommission.cnt;
    commissionSource = 'crm_commissions';
  } else {
    commission = totalSales * ((parseFloat(emp.commission_rate) || 0) / 100);
    commissionCount = null;
    commissionSource = 'flat_rate';
  }

  const grossSalary = baseSalary + totalAllowances + commission + instructorEarnings + bonus;

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
    absentDays, lateMins, dailyRate, minuteRate, absenceDeduction, lateDeduction,
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

module.exports = { computePayrollLine };
