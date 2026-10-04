'use strict';
// The company's attendance rules (lib/attendancePolicy.js), as the owner set
// them: Friday off; 11:00–18:30; lateness over 10 minutes costs a quarter day,
// over 30 half a day, over two hours the whole day; a monthly morning
// permission of two hours and an evening one of an hour and a half.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMonth, tierDays, DEFAULT_TIERS } = require('../lib/attendancePolicy');

const POLICY = {
  weekend_days_json: [5], work_start_time: '11:00:00', work_end_time: '18:30:00',
  morning_permit_minutes: 120, evening_permit_minutes: 90,
  morning_permits_per_month: 1, evening_permits_per_month: 1,
};
const NO_PERMITS = { ...POLICY, morning_permits_per_month: 0, evening_permits_per_month: 0 };
const day = (result, date) => result.days.find(d => d.date === date);

test('the tiers: exactly 10 minutes is free, 11 a quarter, 31 a half, 121 the day', () => {
  assert.equal(tierDays(10, DEFAULT_TIERS), 0);
  assert.equal(tierDays(11, DEFAULT_TIERS), 0.25);
  assert.equal(tierDays(30, DEFAULT_TIERS), 0.25);
  assert.equal(tierDays(31, DEFAULT_TIERS), 0.5);
  assert.equal(tierDays(120, DEFAULT_TIERS), 0.5);
  assert.equal(tierDays(121, DEFAULT_TIERS), 1);
});

test('Friday is off; a working day with no punch is an absence; the month is judged only up to today', () => {
  // October 2026: the 2nd is a Friday.
  const r = evaluateMonth({ policy: NO_PERMITS, month: '2026-10', punches: { '2026-10-01': ['10:55', '18:40'] }, lastDate: '2026-10-05' });
  assert.deepEqual(r.days.map(d => d.date), ['2026-10-01', '2026-10-03', '2026-10-04', '2026-10-05'], 'no Friday, nothing after the 5th');
  assert.equal(day(r, '2026-10-01').status, 'PRESENT');
  assert.equal(day(r, '2026-10-03').status, 'ABSENT');
  assert.equal(r.summary.absent, 3);
});

test('first and last punch of the day; lateness and early leave both use the tiers, capped at one day', () => {
  const r = evaluateMonth({
    policy: NO_PERMITS, month: '2026-10', lastDate: '2026-10-07',
    punches: {
      '2026-10-01': ['11:10', '13:00', '18:30'], // 10 min late: free
      '2026-10-03': ['11:11', '18:30'],          // quarter
      '2026-10-04': ['11:45', '18:30'],          // half
      '2026-10-05': ['13:30', '18:30'],          // whole day
      '2026-10-06': ['11:00', '17:45'],          // left 45 min early: half
      '2026-10-07': ['12:00', '17:00'],          // late 60 (½) + early 90 (½) = 1, capped
    },
  });
  assert.deepEqual(['01', '03', '04', '05', '06', '07'].map(d => day(r, `2026-10-${d}`).deductionDays), [0, 0.25, 0.5, 1, 0.5, 1]);
  assert.equal(day(r, '2026-10-01').checkIn, '11:10');
  assert.equal(day(r, '2026-10-01').checkOut, '18:30');
  assert.equal(r.summary.deductionDays, 3.25);
});

test('the monthly morning permission goes to the day it saves most; the evening one likewise', () => {
  const r = evaluateMonth({
    policy: POLICY, month: '2026-10', lastDate: '2026-10-05',
    punches: {
      '2026-10-01': ['11:20', '18:30'], // late 20: ¼
      '2026-10-03': ['12:40', '18:30'], // late 100: ½ — the permission makes it free
      '2026-10-04': ['11:00', '17:10'], // early 80: ½ — the evening permission makes it free
      '2026-10-05': ['11:00', '18:00'], // early 30: ¼ — allowance already spent
    },
  });
  assert.equal(day(r, '2026-10-03').permit, 'morning');
  assert.equal(day(r, '2026-10-03').deductionDays, 0);
  assert.equal(day(r, '2026-10-01').deductionDays, 0.25, 'only one morning permission a month');
  assert.equal(day(r, '2026-10-04').permit, 'evening');
  assert.equal(day(r, '2026-10-04').deductionDays, 0);
  assert.equal(day(r, '2026-10-05').deductionDays, 0.25);
  assert.equal(r.summary.morningPermitsUsed, 1);
  assert.equal(r.summary.eveningPermitsUsed, 1);
});

test('a permission longer than the lateness covers it; past the permission the rest is charged', () => {
  const r = evaluateMonth({
    policy: POLICY, month: '2026-10', lastDate: '2026-10-01',
    punches: { '2026-10-01': ['13:45', '18:30'] }, // 165 min late − 120 = 45: ½
  });
  assert.equal(day(r, '2026-10-01').deductionDays, 0.5);
});

test('a permission HR approved is honoured and counts against the month', () => {
  const r = evaluateMonth({
    policy: POLICY, month: '2026-10', lastDate: '2026-10-03',
    punches: { '2026-10-01': ['12:30', '18:30'], '2026-10-03': ['12:30', '18:30'] },
    approvedPermits: [{ date: '2026-10-01', type: 'LATE_PERMIT', startTime: '11:00', endTime: '13:00' }],
  });
  assert.equal(day(r, '2026-10-01').deductionDays, 0);
  assert.equal(day(r, '2026-10-03').deductionDays, 0.5, 'the approved one used the month\'s allowance');
});

test('one punch is flagged for HR and costs nothing; days already decided are left alone', () => {
  const r = evaluateMonth({
    policy: NO_PERMITS, month: '2026-10', lastDate: '2026-10-04',
    punches: { '2026-10-01': ['12:30'], '2026-10-03': ['17:00'] },
    skipDates: new Set(['2026-10-04']),
  });
  assert.equal(day(r, '2026-10-01').flag, 'missing_check_out');
  assert.equal(day(r, '2026-10-01').deductionDays, 0);
  assert.equal(day(r, '2026-10-03').flag, 'missing_check_in');
  assert.equal(day(r, '2026-10-04'), undefined, 'an approved leave day is not judged');
});

test('days before the hire date are not absences', () => {
  const r = evaluateMonth({ policy: NO_PERMITS, month: '2026-10', firstDate: '2026-10-04', lastDate: '2026-10-05' });
  assert.deepEqual(r.days.map(d => d.date), ['2026-10-04', '2026-10-05']);
});
