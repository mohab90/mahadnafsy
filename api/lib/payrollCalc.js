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

  const dailyRate  = baseSalary / workDaysPerMonth;
  const minuteRate = baseSalary / (workDaysPerMonth * workdayMinutes);
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
  const totalDeductions = dedSocial + dedTax + absenceDeduction + lateDeduction + advanceDeduction + deduction;
  // Clamped at zero: deductions may exceed gross (a large advance against a month
  // of absence), and a negative payslip would post a reversed journal entry.
  const netSalary = Math.max(0, grossSalary - totalDeductions);

  return {
    housing, transport, food, otherFixed, totalAllowances,
    dedSocial, dedTax,
    absentDays, lateMins, dailyRate, minuteRate, absenceDeduction, lateDeduction,
    commission, commissionCount, commissionSource,
    advanceDeduction, instructorEarnings, bonus, deduction,
    grossSalary, totalDeductions, netSalary,
    // Not used in the arithmetic above, but written into the payslip's
    // calculation_details so it reconciles. They were in scope when this lived
    // inline in the route; after extraction the route referenced them as free
    // variables and every payroll run threw a ReferenceError.
    totalSales, unpaidLeaveDays,
  };
}

module.exports = { computePayrollLine };
