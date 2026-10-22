'use strict';
/**
 * GET /api/admin/leads?ids=… answers just those leads, in the list's shape and
 * within the caller's scope — what the dashboard fetches after a payment
 * instead of the whole table. Against a real MariaDB; runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-ops-leads-it';
let pool; let router;

async function list(query, extra = {}) {
  const layer = router.stack.find(item => item.route?.path === '/api/admin/leads' && item.route.methods.get);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  await layer.route.stack.at(-1).handle({
    params: {}, query, headers: {}, tenantId: TENANT, user: { uid: 'u', email: 'it@example.test' },
    isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined, ...extra,
  }, res);
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/admin/leads/lists');
  await pool.query('DELETE FROM leads WHERE tenant_id=?', [TENANT]);
  for (const [id, phone, sales, hidden] of [['ld-ops-1', '01000000001', 'rep-a', 0], ['ld-ops-2', '01000000002', 'rep-b', 0], ['ld-ops-3', '01000000003', 'rep-a', 0], ['ld-ops-4', '01000000004', 'rep-a', 1]]) {
    await pool.query(
      'INSERT INTO leads (id, tenant_id, name, phone, source, status, assigned_sales_id, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, TENANT, `Lead ${id}`, phone, 'website', 'new', sales, hidden]);
  }
});

after(async () => {
  if (!ENABLED) return;
  await pool.query('DELETE FROM leads WHERE tenant_id=?', [TENANT]);
  await pool.end().catch(() => {});
});

test('only the leads asked for, hidden ones never', { skip }, async () => {
  const res = await list({ ids: 'ld-ops-1,ld-ops-3,ld-ops-4,ld-missing', limit: '100' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.map(row => row.id).sort(), ['ld-ops-1', 'ld-ops-3']);
  const full = (await list({ limit: '100' })).body.find(row => row.id === 'ld-ops-1');
  assert.deepEqual(res.body.find(row => row.id === 'ld-ops-1'), full, 'the same row the whole list carries');
  const all = await list({ limit: '100' });
  assert.equal(all.body.length, 3, 'without ids, the whole (visible) list as before');
});

test('a rep asking by id still sees only their own leads', { skip }, async () => {
  const res = await list({ ids: 'ld-ops-1,ld-ops-2' }, { isSuperAdmin: false, staffRecord: { id: 'rep-a', role: 'sales', data_scope: 'assigned_sales' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.map(row => row.id), ['ld-ops-1']);
});
