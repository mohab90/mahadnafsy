'use strict';
/**
 * Customer service, without view_leads, opens any client's file (GET /api/staff/client/:code). Runs only with DB_*.
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

test('customer service opens any client\'s file, assigned to it or not', { skip }, async () => {
  // GET /api/staff/client/:code named three roles by hand; customer service
  // (data scope 'all') got 403 and the page read «العميل غير موجود».
  await pool.query("UPDATE subscribers SET deleted_at=NULL, is_active=1 WHERE id='cdb-sub-1'");
  const subs = require('../../routes/admin/subscribers');
  const layer = subs.stack.find(l => l.route?.path === '/api/staff/client/:code' && l.route.methods.get);
  const call = async staff => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await layer.route.stack.at(-1).handle({ params: { code: 'CDB1' }, query: {}, body: {}, headers: {}, tenantId: TENANT,
      user: { uid: staff.id }, staffRecord: staff, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined }, res);
    return res;
  };
  const support = await call({ id: 'cdb-cs', role: 'support', tenant_id: TENANT });
  assert.equal(support.statusCode, 200, JSON.stringify(support.body));
  assert.equal(support.body.data.name, 'نورا الأرشيف');
  // A sales rep still sees only their own clients.
  const sales = await call({ id: 'cdb-rep', role: 'sales', tenant_id: TENANT });
  assert.equal(sales.statusCode, 403);
});
