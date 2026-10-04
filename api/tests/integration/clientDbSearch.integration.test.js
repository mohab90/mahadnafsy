'use strict';
/**
 * GET /api/admin/client-db/search against a real MariaDB: one search finds an
 * archived client, an archived lead, an imported Saudi-data lead and a site
 * sign-up, says where each is and where it came from, and answers a customer
 * service account (view_client_db, no view_leads). Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-clientdb-it';
let pool, router;

async function search(q, staff) {
  const layer = router.stack.find(l => l.route?.path === '/api/admin/client-db/search');
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({
    params: {}, query: { q }, body: {}, headers: {}, tenantId: TENANT, user: { uid: staff?.id || 'admin' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}
async function clean() {
  for (const table of ['subscribers', 'leads', 'users', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]);
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/misc/clientDbSearch');
  await clean();
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, client_code, name, phone, email, branch, source, is_active, deleted_at, created_at) VALUES
       ('cdb-sub-1', ?, 'CDB1', 'نورا الأرشيف', '1015550001', 'nora@x.test', 'ONLINE_EGYPT', 'facebook', 0, NOW(), NOW())`, [TENANT]);
  await pool.query(
    `INSERT INTO leads (id, tenant_id, client_code, name, phone, source, status, branch, hidden, created_at) VALUES
       ('cdb-lead-1', ?, 'CDB2', 'نورا المؤرشفة', '1015550002', 'تسجيل دخول', 'archived', 'ONLINE_EGYPT', 0, NOW()),
       ('cdb-lead-2', ?, 'CDB3', 'نورا السعودية', '966501112223', 'دولي قديم — موزّع', 'new', 'ONLINE_SAUDI', 0, NOW())`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active) VALUES
       ('cdb-user-1', ?, 'nora.signup@x.test', '1015550003', 'x', 'نورا المسجلة', 'user', 1)`, [TENANT]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('one search finds archived clients, every kind of lead and site sign-ups, with place and source', { skip }, async () => {
  const { body } = await search('نورا');
  const byId = Object.fromEntries(body.rows.map(r => [r.id, r]));
  assert.equal(byId['cdb-sub-1'].place, 'أرشيف العملاء');
  assert.equal(byId['cdb-lead-1'].place, 'أرشيف الليدز');
  assert.equal(byId['cdb-lead-1'].source, 'تسجيل دخول');
  assert.equal(byId['cdb-lead-2'].place, 'داتا سعودي');
  assert.equal(byId['cdb-user-1'].place, 'تسجيل دخول بالموقع');
});

test('a phone number is found in whatever spelling it was typed', { skip }, async () => {
  const { body } = await search('+20 101 555 0002');
  assert.deepEqual(body.rows.map(r => r.id), ['cdb-lead-1']);
});

test('customer service, without view_leads, gets the whole database', { skip }, async () => {
  const support = { id: 'cdb-cs', role: 'support', permissions_json: '["view_client_db"]', tenant_id: TENANT };
  const res = await search('نورا', support);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.rows.length, 4);
});
