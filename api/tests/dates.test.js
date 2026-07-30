'use strict';
/**
 * Unit tests for lib/dates — defensive date coercion used across reports/ledger to
 * avoid "Invalid time value" on MySQL zero-dates / bad strings. Pure. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  safeIsoString, safeDateOnly, monthRange, dateOnlyInTimeZone,
  addDaysToDateOnly, isValidDateOnly,
} = require('../lib/dates');

test('safeIsoString: valid Date and date strings → ISO', () => {
  assert.equal(safeIsoString(new Date('2026-06-22T00:00:00Z')), '2026-06-22T00:00:00.000Z');
  assert.equal(safeIsoString('2026-06-22'), '2026-06-22T00:00:00.000Z');
});

test('safeIsoString: empty / null / undefined → empty string', () => {
  assert.equal(safeIsoString(''), '');
  assert.equal(safeIsoString(null), '');
  assert.equal(safeIsoString(undefined), '');
});

test('safeIsoString: MySQL zero-date → empty string (no crash)', () => {
  assert.equal(safeIsoString('0000-00-00 00:00:00'), '');
  assert.equal(safeIsoString('0000-00-00'), '');
});

test('safeIsoString: invalid Date object → empty; unparseable string → raw passthrough', () => {
  assert.equal(safeIsoString(new Date('nonsense')), '');
  assert.equal(safeIsoString('not-a-date'), 'not-a-date');
});

test('safeDateOnly: returns YYYY-MM-DD, empty for zero-date', () => {
  assert.equal(safeDateOnly('2026-06-22T13:45:00Z'), '2026-06-22');
  assert.equal(safeDateOnly('0000-00-00'), '');
  assert.equal(safeDateOnly(null), '');
});

test('monthRange: half-open [start, nextMonthStart) for a normal month', () => {
  assert.deepEqual(monthRange('2026-06'), { startDate: '2026-06-01', endDate: '2026-07-01' });
  assert.deepEqual(monthRange('2026-01'), { startDate: '2026-01-01', endDate: '2026-02-01' });
});

test('monthRange: December rolls over to next January (year boundary)', () => {
  assert.deepEqual(monthRange('2026-12'), { startDate: '2026-12-01', endDate: '2027-01-01' });
});

test('monthRange: tolerates a trailing day component, uses only YYYY-MM', () => {
  assert.deepEqual(monthRange('2026-06-15'), { startDate: '2026-06-01', endDate: '2026-07-01' });
});

test('monthRange: malformed / out-of-range input → null (caller rejects)', () => {
  assert.equal(monthRange('2026-13'), null); // month 13 invalid
  assert.equal(monthRange('2026-00'), null); // month 0 invalid
  assert.equal(monthRange('not-a-month'), null);
  assert.equal(monthRange(''), null);
  assert.equal(monthRange(null), null);
});

test('dateOnlyInTimeZone does not drift across the Cairo UTC boundary', () => {
  assert.equal(dateOnlyInTimeZone(new Date('2026-07-28T22:30:00Z')), '2026-07-29');
  assert.equal(dateOnlyInTimeZone(new Date('2026-01-01T21:30:00Z')), '2026-01-01');
});

test('date-only helpers add days across month/year boundaries and reject impossible dates', () => {
  assert.equal(addDaysToDateOnly('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToDateOnly('2026-03-01', -1), '2026-02-28');
  assert.equal(isValidDateOnly('2026-02-28'), true);
  assert.equal(isValidDateOnly('2026-02-31'), false);
  assert.equal(addDaysToDateOnly('2026-02-31', 1), '');
});
