'use strict';
// Payroll is the money-critical part of HR and had almost no coverage, because
// the arithmetic lived inline in the route. These pin the rules that decide what
// a person is actually paid — a silent regression here is a wrong salary, which
// nobody notices until someone complains.
const { test } = require('node:test');
const assert = require('node:assert');
const { computePayrollLine } = require('../lib/payrollCalc');

const EMP = {
  housing_allowance: 1000,
  transport_allowance: 500,
  food_allowance: 300,
  other_fixed: 200,
  deduction_social_insurance: 400,
  deduction_tax: 600,
  commission_rate: 10,
};
const CTX = {
  salaryFx: 1, baseSalary: 10000, workDaysPerMonth: 26, workdayMinutes: 480,
  attendance: {}, crmCommission: null, totalSales: 0,
  advanceDeduction: 0, instructorEarnings: 0, bonus: 0, deduction: 0,
};

test('a clean month: gross = base + allowances, net = gross - fixed deductions', () => {
  const r = computePayrollLine(EMP, CTX);
  assert.equal(r.totalAllowances, 2000);          // 1000+500+300+200
  assert.equal(r.grossSalary, 12000);             // 10000 + 2000
  assert.equal(r.totalDeductions, 1000);          // 400 social + 600 tax
  assert.equal(r.netSalary, 11000);
});

test('absence is charged at the daily rate, and unpaid leave counts as absence', () => {
  const r = computePayrollLine(EMP, {
    ...CTX, attendance: { absent_days: 2, unpaid_leave_days: 1 },
  });
  assert.equal(r.absentDays, 3);                  // 2 absent + 1 unpaid leave
  assert.equal(r.dailyRate, 10000 / 26);
  assert.equal(r.absenceDeduction, (10000 / 26) * 3);
});

test('lateness is charged per minute, not per day', () => {
  const r = computePayrollLine(EMP, { ...CTX, attendance: { late_minutes: 120 } });
  assert.equal(r.minuteRate, 10000 / (26 * 480));
  assert.equal(r.lateDeduction, (10000 / (26 * 480)) * 120);
  // Two hours late must cost far less than a full absent day.
  assert.ok(r.lateDeduction < r.dailyRate);
});

test('crm_commissions wins over the flat rate when it has rows', () => {
  const r = computePayrollLine(EMP, {
    ...CTX, crmCommission: { amt: 3500, cnt: 4 }, totalSales: 100000,
  });
  assert.equal(r.commission, 3500);
  assert.equal(r.commissionSource, 'crm_commissions');
  assert.equal(r.commissionCount, 4);
  // 10% of 100000 would have been 10000 — the rep must not be paid on both bases.
  assert.notEqual(r.commission, 10000);
});

test('an empty crm_commissions row falls back to the percentage of sales', () => {
  const r = computePayrollLine(EMP, {
    ...CTX, crmCommission: { amt: 0, cnt: 0 }, totalSales: 100000,
  });
  assert.equal(r.commission, 10000);              // 10% of 100000
  assert.equal(r.commissionSource, 'flat_rate');
  assert.equal(r.commissionCount, null);
});

test('bonus and instructor earnings raise gross; advances and manual deductions lower net', () => {
  const r = computePayrollLine(EMP, {
    ...CTX, bonus: 1500, instructorEarnings: 2500, advanceDeduction: 800, deduction: 200,
  });
  assert.equal(r.grossSalary, 10000 + 2000 + 0 + 2500 + 1500);
  assert.equal(r.totalDeductions, 400 + 600 + 800 + 200);
  assert.equal(r.netSalary, 16000 - 2000);
});

test('net salary never goes negative', () => {
  // A large advance against a month of absence can exceed gross; a negative
  // payslip would post a reversed journal entry.
  const r = computePayrollLine(EMP, {
    ...CTX, advanceDeduction: 999999, attendance: { absent_days: 26 },
  });
  assert.equal(r.netSalary, 0);
  assert.ok(r.totalDeductions > r.grossSalary);
});

test('the FX factor scales fixed amounts but never the attendance rates', () => {
  const r = computePayrollLine(EMP, { ...CTX, salaryFx: 2 });
  assert.equal(r.totalAllowances, 4000);          // doubled
  assert.equal(r.dedSocial, 800);
  assert.equal(r.dedTax, 1200);
  // baseSalary arrives already converted, so the daily rate must not double again
  assert.equal(r.dailyRate, 10000 / 26);
});

test('missing or malformed fields degrade to zero instead of NaN', () => {
  const r = computePayrollLine({}, { ...CTX, baseSalary: 5000 });
  assert.equal(r.totalAllowances, 0);
  assert.equal(r.dedSocial, 0);
  assert.equal(r.commission, 0);
  assert.equal(r.netSalary, 5000);
  for (const [key, value] of Object.entries(r)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must be finite`);
  }
});

test('a garbage attendance payload cannot silently wipe out a salary', () => {
  const r = computePayrollLine(EMP, {
    ...CTX, attendance: { absent_days: 'abc', late_minutes: null, unpaid_leave_days: undefined },
  });
  assert.equal(r.absentDays, 0);
  assert.equal(r.lateMins, 0);
  assert.equal(r.netSalary, 11000);
});

test('the payslip detail fields survive the return, not just the arithmetic', () => {
  // Regression: totalSales and unpaidLeaveDays are not used in the calculation
  // but ARE written into calculation_details. They were in scope when this code
  // lived inline in the route; after extraction the route referenced them as
  // free variables and every payroll run threw a ReferenceError.
  const line = computePayrollLine(
    { staff_id: 's1', base_salary: 10000, commission_rate: 5 },
    { totalSales: 40000, attendance: { unpaid_leave_days: 3, absent_days: 1 } }
  );
  assert.equal(line.totalSales, 40000, 'totalSales must be returned for the payslip');
  assert.equal(line.unpaidLeaveDays, 3, 'unpaidLeaveDays must be returned for the payslip');
});

test('a payslip line never returns undefined for a detail field', () => {
  // Defaults matter: JSON.stringify drops undefined keys, so a payslip would be
  // silently missing the field rather than showing a zero.
  const line = computePayrollLine({ staff_id: 's1', base_salary: 5000 }, {});
  assert.equal(typeof line.totalSales, 'number');
  assert.equal(typeof line.unpaidLeaveDays, 'number');
});
