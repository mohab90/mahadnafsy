'use strict';
/**
 * Closing an employee's offboarding against a real MariaDB: their open work
 * must go to a successor before their account is switched off. Runs only with
 * DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-offboard-it';
const DONE = JSON.stringify([{ task: 'تسليم المهام والملفات', done: true }]);
let pool; let router;

async function close(body) {
  const layer = router.stack.find(item => item.route?.path === '/api/admin/hr/offboarding/:id' && item.route.methods.put);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await layer.route.stack.at(-1).handle({
    params: { id: 'off-1' }, body: { status: 'completed', ...body }, query: {}, headers: {}, tenantId: TENANT,
    user: { uid: 'hr-user', email: 'hr@example.test' }, staffRecord: { id: 'st-hr', name: 'HR', role: 'hr' },
    isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}

// Rows a run left behind (an interrupted run, a failed delete) must not
// break the next one: cleared before as well as after.
async function clean() {
  for (const table of ['staff_offboarding', 'leads', 'staff', 'audit_events']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  router = require('../../routes/hr/offboarding');
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-leaving', ?, 'منى المغادرة', 'leaving@example.test', '1012349991', 'SALES', 1, '2025-01-01'),
       ('st-next', ?, 'سارة البديلة', 'next@example.test', '1012349992', 'SALES', 1, '2025-01-01')`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, assigned_sales_id, assigned_sales_name) VALUES
       ('ld-open', ?, 'عميل مفتوح', '1012340001', 'test', 'new', 'st-leaving', 'منى المغادرة'),
       ('ld-won', ?, 'عميل مكسوب', '1012340002', 'test', 'won', 'st-leaving', 'منى المغادرة')`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO staff_offboarding (id, tenant_id, staff_id, staff_name, reason, status, checklist)
     VALUES ('off-1', ?, 'st-leaving', 'منى المغادرة', 'resignation', 'in_progress', ?)`, [TENANT, DONE]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('an employee with open work cannot be switched off without a successor', { skip }, async () => {
  const res = await close({});
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'SUCCESSOR_REQUIRED');
  assert.equal(res.body.assigned_work.leads, 1, 'the open lead is counted; the won one is not');
  const [[staff]] = await pool.query("SELECT is_active FROM staff WHERE id='st-leaving'");
  assert.equal(Number(staff.is_active), 1, 'nothing changed');
});

test('with a successor the open work moves and the account is switched off', { skip }, async () => {
  const res = await close({ reassign_to: 'st-next' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [leads] = await pool.query("SELECT id, assigned_sales_id FROM leads WHERE tenant_id=? ORDER BY id", [TENANT]);
  assert.deepEqual(leads.map(l => [l.id, l.assigned_sales_id]), [['ld-open', 'st-next'], ['ld-won', 'st-leaving']]);
  const [[staff]] = await pool.query("SELECT is_active FROM staff WHERE id='st-leaving'");
  assert.equal(Number(staff.is_active), 0);
});
