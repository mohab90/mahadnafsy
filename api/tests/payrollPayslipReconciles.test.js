'use strict';

// A payslip line by line must add up to the net salary the run stored (11 Nov 2026): every amount computePayrollLine adds or takes off has a line on it,
// teaching fees included (they were folded into the net with no line).
const test = require('node:test');
const assert = require('node:assert/strict');
const { computePayrollLine } = require('../lib/payrollCalc');
const { payslipBreakdown } = require('../lib/payslipBreakdown');

test('the payslip\'s lines add up to its net, with teaching fees, overtime, an advance and the manager\'s deduction', () => {
  const emp = { housing_allowance: 300, transport_allowance: 100, deduction_social_insurance: 150, deduction_tax: 50 };
  const line = computePayrollLine(emp, {
    baseSalary: 6000, attendance: { absent_days: 1, absent_charged_days: 2, late_minutes: 20, late_deduction_days: 0.25, overtime_days: 1 },
    advanceDeduction: 500, instructorEarnings: 800, bonus: 700, deduction: 120,
  });
  const item = {
    base_salary: 6000, total_allowances: line.totalAllowances, commission: line.commission, bonus: line.bonus, late_deductions: line.lateDeduction,
    absence_deductions: line.absenceDeduction, advance_deductions: line.advanceApplied, other_deductions: line.dedSocial + line.dedTax + line.deduction, net_salary: line.netSalary,
    calculation_details: JSON.stringify({ instructorEarnings: line.instructorEarnings, overtimePay: line.overtimePay, deductionTotal: line.deduction, dedSocial: line.dedSocial, dedTax: line.dedTax }),
  };
  const slip = payslipBreakdown(item, [], 'APPROVED');
  assert.equal(slip.teachingFees, 800);
  const added = slip.base + slip.allowances + slip.commission + slip.teachingFees + slip.overtime + slip.bonus;
  const taken = slip.lateDeduction + slip.absenceDeduction + slip.advanceDeduction + slip.otherDeduction;
  assert.equal(Math.round((added - taken) * 100) / 100, slip.net);
});
