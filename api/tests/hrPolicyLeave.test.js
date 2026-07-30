'use strict';
// Leave day counts feed payroll deductions and balances, and HR was the most
// thinly covered domain in the audit (3 test files for 22 tables). These lock the
// pure policy logic: weekend handling, half-day permissions, and the guards that
// stop an invalid range from silently becoming zero paid days.
const { test } = require('node:test');
const assert = require('node:assert');
const { calculateLeaveDays, leaveAllowance, DEFAULT_POLICY, LEAVE_TYPES } = require('../lib/hrPolicy');

// 2026-01-01 is a Thursday, so in the default weekend [5,6] (Fri, Sat):
//   Thu 01 = working, Fri 02 = weekend, Sat 03 = weekend,
//   Sun 04 = working, Mon 05 = working
const THU = '2026-01-01', FRI = '2026-01-02', SAT = '2026-01-03', MON = '2026-01-05';

/** Run fn, return the thrown error (fails the test if nothing throws). */
function caught(fn) {
  try { fn(); } catch (e) { return e; }
  assert.fail('expected the call to throw');
}

test('rejects an unknown leave type with a 400', () => {
  const err = caught(() => calculateLeaveDays(THU, MON, 'VACATION'));
  assert.equal(err.statusCode, 400);
  assert.match(err.message, /Invalid leave type/);
});

test('every declared leave type is accepted by the type guard', () => {
  for (const t of LEAVE_TYPES) {
    // PERMISSION short-circuits; the rest must at least not throw on a valid range
    assert.doesNotThrow(() => calculateLeaveDays(THU, MON, t), t);
  }
});

test('rejects reversed or unparseable dates with a 400', () => {
  assert.equal(caught(() => calculateLeaveDays(MON, THU, 'ANNUAL')).statusCode, 400);
  assert.equal(caught(() => calculateLeaveDays('not-a-date', MON, 'ANNUAL')).statusCode, 400);
});

test('PERMISSION is always half a day regardless of range', () => {
  assert.equal(calculateLeaveDays(THU, THU, 'PERMISSION'), 0.5);
  assert.equal(calculateLeaveDays(THU, MON, 'PERMISSION'), 0.5);
});

test('weekend days are excluded from the count', () => {
  // Thu..Mon = 5 calendar days, minus Fri+Sat = 3 working days
  assert.equal(calculateLeaveDays(THU, MON, 'ANNUAL'), 3);
  assert.equal(calculateLeaveDays(THU, THU, 'ANNUAL'), 1);
});

test('MATERNITY counts calendar days including weekends', () => {
  assert.equal(calculateLeaveDays(THU, MON, 'MATERNITY'), 5);
  assert.equal(calculateLeaveDays(FRI, SAT, 'MATERNITY'), 2);
});

test('a range that is entirely weekend is rejected, not silently zero', () => {
  const err = caught(() => calculateLeaveDays(FRI, SAT, 'ANNUAL'));
  assert.equal(err.statusCode, 400);
  assert.match(err.message, /no working days/);
});

test('a custom weekend policy is honoured, as JSON string or array', () => {
  // Sunday-only weekend: Thu..Mon loses only Sun 04 -> 4 days
  assert.equal(calculateLeaveDays(THU, MON, 'ANNUAL', { weekend_days_json: [0] }), 4);
  assert.equal(calculateLeaveDays(THU, MON, 'ANNUAL', { weekend_days_json: '[0]' }), 4);
});

test('a malformed weekend policy falls back to the default Fri/Sat weekend', () => {
  assert.equal(calculateLeaveDays(THU, MON, 'ANNUAL', { weekend_days_json: '{not json' }), 3);
  assert.equal(calculateLeaveDays(THU, MON, 'ANNUAL', { weekend_days_json: null }), 3);
  // out-of-range day numbers are discarded rather than shifting the weekend
  assert.equal(calculateLeaveDays(THU, MON, 'ANNUAL', { weekend_days_json: [99, 5, 6] }), 3);
});

test('leaveAllowance maps only the entitled types', () => {
  assert.equal(leaveAllowance(DEFAULT_POLICY, 'ANNUAL'), 21);
  assert.equal(leaveAllowance(DEFAULT_POLICY, 'SICK'), 14);
  for (const t of ['UNPAID', 'MATERNITY', 'EMERGENCY', 'PERMISSION', 'OTHER']) {
    assert.equal(leaveAllowance(DEFAULT_POLICY, t), null, t);
  }
});

test('default policy keeps payroll-relevant constants intact', () => {
  assert.equal(DEFAULT_POLICY.work_days_per_month, 26);
  assert.equal(DEFAULT_POLICY.workday_minutes, 480);
  assert.equal(DEFAULT_POLICY.overtime_multiplier, 1.5);
  assert.deepEqual(DEFAULT_POLICY.weekend_days_json, [5, 6]);
});
