'use strict';
/**
 * Instalment plans and who may read or change them, on a real MariaDB (these were regular expressions over routes/installments.js — `requireScopedSubscriber`,
 * `resolveFinancialScope … allowAssigned`, `financialRecordMatches`, the switch `INSTALLMENT_WRITES_ENABLED`; paying an instalment is in deskInstalmentPayment):
 * a plan is read and written only for a client inside the caller's financial scope, only with the right permission, and only with a schedule and a positive total; a
 * collection officer can schedule only what is left of the agreed price; a plan with a payment on it is never deleted and an unpaid entry can be removed; the writes
 * can be switched off with one setting and say so. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-instplan-it';
let pool; let router;

const staff = (id, role, permissions, extra = {}) => ({ id, name: id, role, permissions_json: JSON.stringify(permissions), ...extra });
const ACCOUNTS = staff('st-ip-acc', 'accountant', ['view_financial', 'manage_financial']);
const VIEWER = staff('st-ip-view', 'accountant', ['view_financial']);
const DOKKI = staff('st-ip-dk', 'accountant', ['view_financial', 'manage_financial'], { data_scope: 'branch:DAQQI', branch_id: 'branch-daqqi' });
const COLLECTOR = staff('st-ip-col', 'collection', ['view_financial', 'manage_financial']);

async function call(method, path, { params = {}, body = {}, who = ACCOUNTS } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'acc-ip@example.test', tenant_id: T }, staffRecord: who, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const PLAN = '/api/admin/subscribers/:subscriberId/installment-plans';
const entries = (...amounts) => amounts.map((amount, index) => ({ amount, dueDate: `2026-12-${String(10 + index).padStart(2, '0')}` }));
const create = (subscriberId, body = {}, who) => call('post', PLAN, { params: { subscriberId }, who, body: { courseId: 'co-ip-1', title: 'خطة', totalAmount: 900, currency: 'EGP', entries: entries(300, 300, 300), ...body } });
const list = (subscriberId, who) => call('get', PLAN, { params: { subscriberId }, who });

async function clean() {
  for (const table of ['installment_entries', 'installment_plans', 'payments', 'subscribers', 'courses', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/installments');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-ip-acc', ?, 'المحاسب', 'acc-ip@example.test', '1019400001', 'ACCOUNTANT', 1, '2025-01-01'),
       ('st-ip-dk', ?, 'محاسب الدقي', 'dk-ip@example.test', '1019400002', 'ACCOUNTANT', 1, '2025-01-01'),
       ('st-ip-col', ?, 'تحصيل', 'col-ip@example.test', '1019400003', 'COLLECTION', 1, '2025-01-01')`, [T, T, T]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES ('co-ip-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 900)`, [T]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id, assigned_cs_id) VALUES
       ('sub-ip-online', ?, 'عميل أونلاين', '1019400010', 'ONLINE_EGYPT', 'branch-online-egypt', NULL),
       ('sub-ip-dokki', ?, 'عميل الدقي', '1019400011', 'DAQQI', 'branch-daqqi', NULL),
       ('sub-ip-col', ?, 'عميل المحصّل', '1019400012', 'ONLINE_EGYPT', 'branch-online-egypt', 'st-ip-col')`, [T, T, T]);
});
after(async () => {
  if (!ENABLED) return;
  delete process.env.INSTALLMENT_WRITES_ENABLED;
  await clean();
  await pool.end();
});

test('a plan needs a schedule and a positive total, and a client inside the caller\'s financial scope', { skip }, async () => {
  assert.equal((await create('sub-ip-online', { entries: [] })).statusCode, 400, 'a schedule is needed');
  assert.equal((await create('sub-ip-online', { totalAmount: 0 })).statusCode, 400);
  assert.equal((await create('sub-ip-nobody')).statusCode, 404);
  const outside = await create('sub-ip-online', {}, DOKKI);
  assert.equal(outside.statusCode, 404, 'a branch accountant does not reach another branch\'s client');
  assert.equal((await create('sub-ip-dokki', {}, DOKKI)).statusCode, 200, 'but their own branch\'s');
  assert.equal((await create('sub-ip-online', {}, VIEWER)).statusCode, 403, 'view_financial alone does not write');
  assert.equal((await pool.query("SELECT id FROM installment_plans WHERE tenant_id=? AND subscriber_id='sub-ip-online'", [T]))[0].length, 0, 'no plan came of the refusals');
  const made = await create('sub-ip-online');
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM installment_entries WHERE plan_id=?', [made.body.id]))[0][0].n, 3, 'its rows are kept in step');
});

test('plans are read inside the scope only; a collection officer can schedule only what is left of the agreed price', { skip }, async () => {
  const mine = await list('sub-ip-online');
  assert.equal(mine.statusCode, 200);
  assert.equal(mine.body.length, 1);
  assert.equal(Number(mine.body[0].total_amount), 900);
  assert.equal((await list('sub-ip-online', DOKKI)).statusCode, 404, 'not another branch\'s client');
  assert.equal((await list('sub-ip-nobody')).statusCode, 404);

  const price = await create('sub-ip-col', { totalAmount: 450, entries: entries(150, 150, 150) }, COLLECTOR);
  assert.equal(price.statusCode, 403);
  assert.equal(price.body.code, 'COLLECTION_PRICE_LOCKED', 'a plan of any other total is a price change, which is the accounts\'');
  assert.equal((await pool.query("SELECT id FROM installment_plans WHERE tenant_id=? AND subscriber_id='sub-ip-col'", [T]))[0].length, 0);
});

test('a plan with a payment on it is never deleted, an unpaid entry can be removed, and the writes can be switched off', { skip }, async () => {
  const [[plan]] = await pool.query("SELECT id FROM installment_plans WHERE tenant_id=? AND subscriber_id='sub-ip-online'", [T]);
  const removeEntry = (id, index, who) => call('delete', '/api/admin/installment-plans/:planId/entries/:index', { params: { planId: id, index: String(index) }, who });
  assert.equal((await removeEntry(plan.id, 2, DOKKI)).statusCode, 404, 'out of scope');
  const removed = await removeEntry(plan.id, 2);
  assert.equal(removed.statusCode, 200, JSON.stringify(removed.body));
  const [[after]] = await pool.query('SELECT installments_count, total_amount FROM installment_plans WHERE id=?', [plan.id]);
  assert.deepEqual([Number(after.installments_count), Number(after.total_amount)], [2, 600], 'one entry fewer and the total follows');

  await pool.query("UPDATE installment_plans SET paid_count=1 WHERE id=?", [plan.id]);
  const deletePlan = (id, who) => call('delete', '/api/admin/installment-plans/:planId', { params: { planId: id }, who });
  assert.equal((await deletePlan(plan.id)).statusCode, 409, 'real financial history is not deleted');
  await pool.query("UPDATE installment_plans SET paid_count=0 WHERE id=?", [plan.id]);
  assert.equal((await deletePlan(plan.id, DOKKI)).statusCode, 404, 'not out of scope');
  assert.equal((await deletePlan(plan.id)).statusCode, 200, 'an unpaid plan goes');
  assert.equal((await pool.query('SELECT id FROM installment_plans WHERE id=?', [plan.id]))[0].length, 0);

  process.env.INSTALLMENT_WRITES_ENABLED = 'false';
  const off = await create('sub-ip-online');
  assert.equal(off.statusCode, 409);
  assert.equal(off.body.code, 'INSTALLMENT_WRITES_DISABLED', 'switched off, it says so');
  assert.equal((await list('sub-ip-online')).statusCode, 200, 'reading is not switched off');
  delete process.env.INSTALLMENT_WRITES_ENABLED;
});
