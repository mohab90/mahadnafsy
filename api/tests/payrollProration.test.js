'use strict';

// The days of a month an employee belongs to, and the line computePayrollLine builds from them (11 Nov 2026): a thirtieth of the salary per calendar day, capped at 30,
// allowances pro-rated, a day lost to absence still a thirtieth of the WHOLE salary.
const test = require('node:test');
const assert = require('node:assert/strict');
const { employmentWindow } = require('../lib/payrollProration');
const { computePayrollLine } = require('../lib/payrollCalc');

const window = (hireDate, terminationDate, isActive = 1, year = 2027, month = 6) => employmentWindow({ hireDate, terminationDate, isActive, year, month });

test('a month he belonged to from first to last day is whole, whatever its length', () => {
  for (const [year, month] of [[2027, 2], [2027, 6], [2027, 7]]) {
    const full = window('2025-01-01', null, 1, year, month);
    assert.equal(full.partial, false);
    assert.equal(full.paidDays, 30);
    assert.equal(full.factor, 1);
  }
  assert.equal(window('2027-07-01', null, 1, 2027, 7).paidDays, 30, 'joined on the 1st of a 31-day month');
  assert.equal(window('2027-07-02', null, 1, 2027, 7).paidDays, 30, '30 days (2nd to 31st)');
  assert.equal(window('2027-07-03', null, 1, 2027, 7).paidDays, 29);
});

test('joined, left, or both inside the month; the days are inclusive', () => {
  assert.deepEqual([window('2027-06-16', null).fromDay, window('2027-06-16', null).paidDays], [16, 15]);
  assert.deepEqual([window('2025-01-01', '2027-06-10', 0).toDay, window('2025-01-01', '2027-06-10', 0).paidDays], [10, 10]);
  assert.equal(window('2027-06-05', '2027-06-20', 0).paidDays, 16);
  assert.equal(window('2027-02-16', null, 1, 2027, 2).paidDays, 13);
  assert.equal(window('2025-01-01', '2027-02-28', 0, 2027, 2).partial, false, 'left on the last day of February: the whole month');
});

test('outside the month: not hired yet, or gone before it; a stale leaving date on an active employee is ignored; no hire date is the full month', () => {
  assert.equal(window('2027-07-03', null).include, false);
  assert.equal(window('2025-01-01', '2027-05-20', 0).include, false);
  assert.equal(window('2025-01-01', '2027-05-20', 1).include, true, 'rehired: the old leaving date is not a leaving');
  const unknown = window(null, null);
  assert.deepEqual([unknown.include, unknown.noHireDate, unknown.paidDays], [true, true, 30]);
  assert.equal(window('2025-01-01', '2027-07-05', 1).paidDays, 30, 'leaving next month changes nothing this month');
});

test('the pay line: pro-rated basic and allowances, a day of absence at a thirtieth of the whole salary', () => {
  const line = computePayrollLine({ housing_allowance: 600 }, { baseSalary: 3000, paidDays: 15, attendance: { absent_days: 1, absent_charged_days: 2 } });
  assert.equal(line.paidBase, 1500);
  assert.equal(line.housing, 300);
  assert.equal(line.absenceDeduction, 200, 'two days at 3,000/30, not at the pro-rated figure');
  assert.equal(line.netSalary, 1500 + 300 - 200);
  const whole = computePayrollLine({}, { baseSalary: 3000 });
  assert.equal(whole.paidBase, 3000, 'no paidDays given: the whole month');
});
