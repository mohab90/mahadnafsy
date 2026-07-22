'use strict';
/**
 * Unit tests for lib/periodLock — the accounting period lock that makes closed-month
 * transactions immutable (critical financial control). Uses the injectable-db param
 * with a mock — no real DB. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { closedPeriodFor, assertWritable } = require('../lib/periodLock');

const dbWith = (rows) => ({ async query() { return [rows]; } });
const dbThrows = { async query() { throw new Error('no such table'); } };

test('closedPeriodFor: matches the YYYY-MM label of the date', async () => {
  let captured;
  const db = { async query(_sql, params) { captured = params; return [[{ id: 'p1', period_label: '2026-05', status: 'closed' }]]; } };
  const row = await closedPeriodFor('2026-05-17', db, 'tenant-a');
  assert.deepEqual(row, { id: 'p1', period_label: '2026-05', status: 'closed' });
  assert.deepEqual(captured, ['tenant-a', '2026-05'], 'queries by tenant and YYYY-MM slice');
});

test('closedPeriodFor: null date or no match → null', async () => {
  assert.equal(await closedPeriodFor('', dbWith([])), null);
  assert.equal(await closedPeriodFor(null, dbWith([])), null);
  assert.equal(await closedPeriodFor('2026-06-01', dbWith([])), null);
});

test('closedPeriodFor: fails closed if the lock table is missing', async () => {
  await assert.rejects(() => closedPeriodFor('2026-05-01', dbThrows), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.code, 'ACCOUNTING_PERIOD_LOCK_UNAVAILABLE');
    return true;
  });
});

test('assertWritable: throws 409 inside a closed period', async () => {
  const db = dbWith([{ id: 'p1', period_label: '2026-05', status: 'closed' }]);
  await assert.rejects(() => assertWritable('2026-05-10', db), (e) => {
    assert.equal(e.status, 409);
    assert.match(e.message, /مقفول/);
    return true;
  });
});

test('assertWritable: resolves silently when the period is open', async () => {
  await assert.doesNotReject(() => assertWritable('2026-06-10', dbWith([])));
});

test('assertWritable: blocks if the lock table is missing', async () => {
  await assert.rejects(() => assertWritable('2026-05-10', dbThrows), { status: 503 });
});
