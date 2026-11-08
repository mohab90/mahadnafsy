'use strict';
/**
 * 8–9 Nov 2026, «تظهر الجمعه وتكتبه اجازه اسبوعيه ولو حد نزلها تحددها انها اوفر تايم … بيوم ولا يوم ونص ولا يومين» and «السبت يوم عمل عادي»:
 * the month's days under a Friday-only weekend (lib/attendancePolicy.js evaluateMonth) and the overtime in the pay (lib/payrollCalc.js).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMonth } = require('../lib/attendancePolicy');
const { computePayrollLine } = require('../lib/payrollCalc');

// October 2026: the 2nd, 9th, 16th, 23rd and 30th are Fridays; the 3rd, 10th … 31st Saturdays.
const POLICY = { work_start_time: '11:00', work_end_time: '18:30', weekend_days_json: [5], free_day_per_month: 0 };
const worked = (...dates) => Object.fromEntries(dates.map(date => [date, ['10:55', '18:35']]));

test('Saturday is a working day: punched it is present, not punched it is absent; Friday is not a working day', () => {
  const { days, summary } = evaluateMonth({ policy: POLICY, month: '2026-10', punches: worked('2026-10-01', '2026-10-03'), lastDate: '2026-10-04' });
  assert.deepEqual(days.map(day => [day.date, day.status]), [['2026-10-01', 'PRESENT'], ['2026-10-03', 'PRESENT'], ['2026-10-04', 'ABSENT']],
    'the 2nd (Friday) is not a day of the month sheet; the 3rd (Saturday) is');
  assert.equal(summary.workDays, 3);
});

test('a Friday punched on is overtime at the policy\'s rate, judged no further: nobody is late on it, nothing is deducted', () => {
  const late = { '2026-10-23': ['13:40', '17:00'] };
  const { days, summary } = evaluateMonth({ policy: { ...POLICY, weekend_overtime_days: 1.5 }, month: '2026-10', punches: late, firstDate: '2026-10-23', lastDate: '2026-10-23' });
  assert.deepEqual(days.map(day => [day.date, day.status, day.overtimeDays, day.deductionDays, day.lateMinutes]), [['2026-10-23', 'PRESENT', 1.5, 0, 0]]);
  assert.deepEqual([summary.weekendWorked, summary.overtimeDays, summary.workDays], [1, 1.5, 0], 'a Friday worked is no working day of the month');
});

test('the policy\'s default is one day; a single punch on a Friday is still overtime, flagged for HR', () => {
  const { days } = evaluateMonth({ policy: POLICY, month: '2026-10', punches: { '2026-10-30': ['12:00'] }, firstDate: '2026-10-30', lastDate: '2026-10-30' });
  assert.deepEqual(days.map(day => [day.overtimeDays, day.flag]), [[1, 'single_punch']]);
});

test('overtime is paid at the day\'s rate (salary ÷ 30) times the days HR set, on top of the salary', () => {
  const none = computePayrollLine({}, { baseSalary: 6000, attendance: {} });
  const two = computePayrollLine({}, { baseSalary: 6000, attendance: { overtime_days: 2.5 } });
  assert.equal(none.netSalary, 6000);
  assert.deepEqual([two.overtimeDays, two.overtimePay, two.grossSalary, two.netSalary], [2.5, 500, 6500, 6500]);
});
