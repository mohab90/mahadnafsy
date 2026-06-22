'use strict';
/**
 * Unit tests for lib/dates — defensive date coercion used across reports/ledger to
 * avoid "Invalid time value" on MySQL zero-dates / bad strings. Pure. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeIsoString, safeDateOnly } = require('../lib/dates');

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
