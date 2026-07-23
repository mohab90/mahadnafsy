'use strict';
/**
 * Behavioral tests for lib/subscriberProvisioning.js — the fix for LMS-01
 * ("payment succeeds but the customer never gets enrolled because no
 * subscriber row existed yet"). Uses a mock connection, no real DB.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureSubscriberForOrder } = require('../lib/subscriberProvisioning');

function mockConn(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const hit = responses.find(r => sql.includes(r.match));
      if (!hit) throw new Error(`mockConn: no canned response for: ${sql.slice(0, 80)}...`);
      return [hit.rows];
    },
  };
}

test('ensureSubscriberForOrder: returns the existing subscriber untouched when one already matches', async () => {
  const conn = mockConn([
    { match: 'FROM subscribers', rows: [{ id: 'sub-1', lead_id: null, branch: 'ONLINE_EGYPT', branch_id: 'b1', tenant_id: 't1' }] },
  ]);
  const sub = await ensureSubscriberForOrder(conn, { tenantId: 't1', email: 'a@x.com' });
  assert.equal(sub.id, 'sub-1');
  assert.ok(!conn.calls.some(c => c.sql.includes('INSERT INTO subscribers')), 'must not create a duplicate when one already exists');
});

test('ensureSubscriberForOrder: creates a new subscriber (the LMS-01 fix) when none exists, linking a matching lead', async () => {
  const conn = mockConn([
    { match: 'FROM subscribers', rows: [] }, // no existing subscriber
    { match: 'FROM leads', rows: [{ id: 'lead-1', branch: 'TAGAMOA', branch_id: 'b2', assigned_sales_id: 's1', assigned_sales_name: 'Sales Rep' }] },
    { match: 'client_code_counter SET', rows: [] },
    { match: 'FROM client_code_counter', rows: [{ next_value: 101 }] },
    { match: 'INSERT INTO subscribers', rows: [] },
  ]);
  const sub = await ensureSubscriberForOrder(conn, { tenantId: 't1', email: 'new@x.com', name: 'New Customer', phone: '0100' });
  assert.ok(sub.id, 'must return a real subscriber id, not skip silently');
  assert.equal(sub.lead_id, 'lead-1', 'must link the matching lead');
  assert.equal(sub.branch, 'TAGAMOA', 'must inherit the lead branch, not just the fallback');

  const insertCall = conn.calls.find(c => c.sql.includes('INSERT INTO subscribers'));
  assert.ok(insertCall, 'must actually write a subscribers row — this is the exact step LMS-01 was skipping');
  assert.equal(insertCall.params[4], 'New Customer');
  assert.equal(insertCall.params[5], 'new@x.com');
  assert.equal(insertCall.params[13], 't1', 'new subscriber must carry the correct tenant_id');
});

test('ensureSubscriberForOrder: falls back to the given branch when no lead matches', async () => {
  const conn = mockConn([
    { match: 'FROM subscribers', rows: [] },
    { match: 'FROM leads', rows: [] }, // no matching lead either
    { match: 'client_code_counter SET', rows: [] },
    { match: 'FROM client_code_counter', rows: [{ next_value: 102 }] },
    { match: 'INSERT INTO subscribers', rows: [] },
  ]);
  const sub = await ensureSubscriberForOrder(conn, { tenantId: 't1', email: 'nolead@x.com', fallbackBranch: 'ONLINE_SAUDI' });
  assert.equal(sub.branch, 'ONLINE_SAUDI');
  assert.equal(sub.lead_id, null);
});

test('ensureSubscriberForOrder: rejects when no email is provided', async () => {
  await assert.rejects(() => ensureSubscriberForOrder(mockConn([]), { tenantId: 't1', email: '' }));
});
