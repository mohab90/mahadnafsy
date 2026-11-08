'use strict';
/**
 * Recording an instalment at the desk (POST /api/admin/installment-plans/:planId/entries/:index/pay), on a real MariaDB. These were regular expressions
 * over routes/installments.js: the payment row carries the CLIENT'S price for the course in course_expected — never the instalment's own amount, or a
 * client part-way through a plan drops off the outstanding list — it is dated on the institute's (Cairo) day, the plan's entry and its
 * installment_entries row are both marked paid, an entry is paid once, and a collection officer may only plan what is left of the agreed price.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-deskinst-it';
const SUB = 'sub-di-1'; const COURSE = 'co-di-1';
let pool; let router;

const ADMIN = { isSuperAdmin: true, staffRecord: null };
const COLLECTION = { isSuperAdmin: false, staffRecord: { id: 'st-di-col', name: 'التحصيل', role: 'collection', permissions_json: '["manage_financial","view_financial"]' } };

async function call(method, path, { params = {}, body = {}, who = ADMIN } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'boss@example.test' }, ip: '127.0.0.1', get: () => undefined, ...who };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'instructor_fees', 'entitlement_events', 'enrollments', 'outbox',
    'installment_entries', 'installment_plans', 'payments', 'subscribers', 'courses', 'staff', 'tenant_settings', 'receipt_counters']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  router = require('../../routes/installments');
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES (?, ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 3000)`, [COURSE, T]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES (?, ?, 'عميل', '01019300001', 'ONLINE_EGYPT', 'branch-online-egypt')`, [SUB, T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

const makePlan = async (who = ADMIN, total = 2000) => {
  const res = await call('post', '/api/admin/subscribers/:subscriberId/installment-plans', {
    params: { subscriberId: SUB }, who,
    body: { courseId: COURSE, title: 'خطة', totalAmount: total, currency: 'EGP', entries: [{ amount: total / 2, dueDate: '2026-12-01' }, { amount: total / 2, dueDate: '2027-01-01' }] },
  });
  return res;
};

test('an instalment is recorded with the client\'s price for the course, on the institute\'s day, and the plan follows', { skip }, async () => {
  const plan = await makePlan();
  assert.equal(plan.statusCode, 200, JSON.stringify(plan.body));
  const { cairoToday } = require('../../lib/dates');
  const before = cairoToday();
  const res = await call('post', '/api/admin/installment-plans/:planId/entries/:index/pay', { params: { planId: plan.body.id, index: '0' }, body: { amount: 1000, paymentMethod: 'كاش' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [[row]] = await pool.query("SELECT amount, course_expected, is_installment, DATE_FORMAT(date, '%Y-%m-%d') AS day, status FROM payments WHERE tenant_id=? AND source='installment'", [T]);
  assert.equal(Number(row.amount), 1000);
  assert.equal(Number(row.course_expected), 3000, 'the course\'s price (the catalogue\'s, nothing else being agreed), not this instalment\'s 1000 nor the plan\'s 2000');
  assert.equal(Number(row.is_installment), 1);
  assert.equal(row.status, 'paid');
  assert.ok([before, cairoToday()].includes(row.day), `dated ${row.day}: the Cairo day, not the server's UTC one`);
  const [entries] = await pool.query('SELECT seq, paid FROM installment_entries WHERE tenant_id=? AND plan_id=? ORDER BY seq', [T, plan.body.id]);
  assert.deepEqual(entries.map(entry => [Number(entry.seq), Number(entry.paid)]), [[0, 1], [1, 0]], 'the rows beside the plan\'s arrays say the same');
});

test('an entry is paid once', { skip }, async () => {
  const [[plan]] = await pool.query('SELECT id FROM installment_plans WHERE tenant_id=? LIMIT 1', [T]);
  const again = await call('post', '/api/admin/installment-plans/:planId/entries/:index/pay', { params: { planId: plan.id, index: '0' }, body: { amount: 1000, paymentMethod: 'كاش' } });
  assert.ok(again.statusCode >= 400 && again.statusCode < 500, `${again.statusCode} ${JSON.stringify(again.body)}`);
  const [[count]] = await pool.query("SELECT COUNT(*) AS n FROM payments WHERE tenant_id=? AND source='installment'", [T]);
  assert.equal(Number(count.n), 1, 'no second payment row');
});

test('a collection officer plans only what is left of the agreed price', { skip }, async () => {
  await pool.query('UPDATE subscribers SET assigned_cs_id=? WHERE id=? AND tenant_id=?', [COLLECTION.staffRecord.id, SUB, T]);
  const wrong = await makePlan(COLLECTION, 1500);
  assert.equal(wrong.statusCode, 403);
  assert.equal(wrong.body.code, 'COLLECTION_PRICE_LOCKED');
  const right = await makePlan(COLLECTION, 2000);
  assert.equal(right.statusCode, 200, JSON.stringify(right.body));
});
