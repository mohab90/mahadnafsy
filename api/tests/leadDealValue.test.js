'use strict';
/**
 * Unit tests for lib/leadDealValue.syncLeadDealValue — keeps a lead's deal_value in
 * sync with the subscriber's total payments (CRM/forecast money logic). Uses the
 * injectable pool overload (pool, id) with a mock pool — no real DB. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { syncLeadDealValue } = require('../lib/leadDealValue');

function mockPool(routes) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const r of routes) if (sql.includes(r.match)) return r.rows;
      return [[]];
    },
  };
}

test('syncs deal_value from total payments when a lead is linked', async () => {
  const pool = mockPool([
    { match: 'SUM(amount_egp)', rows: [[{ total: 500 }]] },
    { match: 'FROM subscribers', rows: [[{ id: 'S1', lead_id: 'L1', phone: null, email: null }]] },
    { match: 'UPDATE leads', rows: [{}] },
  ]);
  await syncLeadDealValue(pool, 'S1', 'tenant-a');
  const upd = pool.calls.find(c => c.sql.includes('UPDATE leads SET deal_value'));
  assert.ok(upd, 'issues the deal_value update');
  assert.deepEqual(upd.params, [500, 'L1', 'tenant-a']);
});

test('no-op when the subscriber has no positive payments', async () => {
  const pool = mockPool([{ match: 'SUM(amount_egp)', rows: [[{ total: 0 }]] }]);
  await syncLeadDealValue(pool, 'S1', 'tenant-a');
  assert.equal(pool.calls.length, 1, 'returns right after the totals query — no further work');
});

test('no-op when subscriberId is missing (no queries at all)', async () => {
  const pool = mockPool([]);
  await syncLeadDealValue(pool, undefined, 'tenant-a');
  assert.equal(pool.calls.length, 0);
});

test('swallows DB errors instead of throwing (best-effort sync)', async () => {
  const pool = { async query() { throw new Error('boom'); } };
  await assert.doesNotReject(() => syncLeadDealValue(pool, 'S1', 'tenant-a'));
});
