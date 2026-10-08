'use strict';

// HIGH-09 of the 7 Oct 2026 audit: promo_codes had no tenant, so every tenant
// listed, edited, deleted and redeemed every other tenant's codes. Each route
// names its tenant now (migration 255).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-promo-secret-0123456789-abcdefghijklmnopqrstu';

const calls = [];
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query: async (sql, params = []) => { calls.push({ sql: String(sql).replace(/\s+/g, ' '), params }); return [[]]; } },
  cached: async (_k, _t, fn) => fn(), cacheInvalidate() {}, requireDb: (_q, _s, n) => n(), isDbDown: () => false,
  getStaffIdByEmail: async () => null,
});
const router = require('../routes/promo-codes');
const handlerOf = (method, path) => router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]).route.stack.slice(-1)[0].handle;

async function call(method, path, req) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handlerOf(method, path)({ tenantId: 'tenant-b', params: {}, body: {}, user: { email: 'm@x.test' }, ...req }, res);
  return res;
}

test('every promo-code query names the tenant asking', async () => {
  calls.length = 0;
  await call('post', '/api/promo/validate', { body: { code: 'eid10', amount: 1000 } });
  await call('get', '/api/admin/promo-codes', {});
  await call('post', '/api/admin/promo-codes', { body: { code: 'eid10', discount_value: 10 } });
  await call('patch', '/api/admin/promo-codes/:id', { params: { id: 'p-1' }, body: { active: false } });
  await call('delete', '/api/admin/promo-codes/:id', { params: { id: 'p-1' } });
  assert.equal(calls.length, 5);
  for (const { sql, params } of calls) {
    assert.match(sql, /tenant_id/, sql);
    assert.ok(params.includes('tenant-b'), sql);
  }
});
