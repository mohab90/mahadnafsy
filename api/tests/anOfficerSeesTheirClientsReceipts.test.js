'use strict';

// From the production log, 7 Oct 2026: /api/admin/payment-proofs refused 86
// requests with «Aggregate financial reports are not available for this data
// scope», each logged as an error. They came from collection officers, who hold
// view_financial over their own clients, opening a client's profile. The list
// gives them those clients' receipts now, and an admin all of them, as before.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-proofs-secret-0123456789-abcdefghijklmnopqrstu';

const calls = [];
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query: async (sql, params = []) => { calls.push({ sql: String(sql).replace(/\s+/g, ' '), params }); return [[{ id: 'pp-1' }]]; } },
  cached: async (_k, _t, fn) => fn(), cacheInvalidate() {}, requireDb: (_q, _s, n) => n(), isDbDown: () => false,
  getStaffIdByEmail: async () => null,
});
const router = require('../routes/payment-proofs');
const handler = router.stack.find(l => l.route && l.route.path === '/api/admin/payment-proofs' && l.route.methods.get).route.stack.slice(-1)[0].handle;

async function list(req) {
  calls.length = 0;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ query: {}, tenantId: 'tenant-default', ...req }, res);
  return res;
}

test('a collection officer gets their own clients\' receipts, not a refusal', async () => {
  const res = await list({ staffRecord: { id: 'st-coll', role: 'COLLECTION', data_scope: 'assigned_cs' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.match(calls[0].sql, /AND s\.assigned_cs_id=\?/);
  assert.ok(calls[0].params.includes('st-coll'));
});

test('the owner still sees every receipt', async () => {
  const res = await list({ isSuperAdmin: true });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(calls[0].sql, /assigned_cs_id|branch_id=\?/);
});
