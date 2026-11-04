'use strict';
/**
 * 4 Nov 2026: «تقارير المبيعات» counted leads and orders in the browser (it loaded every lead of the tenant to do it, and added amounts of different currencies). GET
 * /api/admin/reports/sales-breakdown answers from the database: leads by status and source, collected money in EGP in total, by employee and by course or track. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-sales-breakdown-it';
let pool, router;

async function clean() {
  for (const table of ['payments', 'leads', 'subscribers', 'courses', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}
const get = async query => {
  const layer = router.stack.find(l => l.route?.path === '/api/admin/reports/sales-breakdown');
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query, body: {}, headers: {}, tenantId: T, user: { uid: 'admin' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  return res;
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/analytics/sales');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('sb-a', ?, 'منى', 'sb-a@x.t', '1019000001', 'SALES', 1, '2025-01-01'), ('sb-b', ?, 'سارة', 'sb-b@x.t', '1019000002', 'SALES', 1, '2025-01-01')`, [T, T]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES ('sb-c1', ?, 'كورس أ', '', '', '', '', 'GENERAL', 'RECORDED', 1000)`, [T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch) VALUES ('sb-s1', ?, 'SB1', 'عميل', '1019100001', 'ONLINE_EGYPT')", [T]);
  const today = new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, staff_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, date) VALUES
       ('sb-p1', ?, 'sb-s1', 'sb-c1', 'sb-a', 1000, 'EGP', 1, 1000, 'COURSE', 'paid', ?),
       ('sb-p2', ?, 'sb-s1', 'sb-c1', 'sb-a', 100, 'SAR', 14, 1400, 'COURSE', 'paid', ?),
       ('sb-p3', ?, 'sb-s1', 'sb-c1', 'sb-b', 500, 'EGP', 1, 500, 'COURSE', 'pending', ?),
       ('sb-p4', ?, 'sb-s1', 'sb-c1', 'sb-b', 300, 'EGP', 1, 300, 'COURSE', 'paid', '2020-01-01')`, [T, today, T, today, T, today, T]);
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, branch, hidden, created_at) VALUES
       ('sb-l1', ?, 'ليد ١', '1019200001', 'facebook', 'new', 'ONLINE_EGYPT', 0, NOW()),
       ('sb-l2', ?, 'ليد ٢', '1019200002', 'facebook', 'converted', 'ONLINE_EGYPT', 0, NOW()),
       ('sb-l3', ?, 'ليد ٣', '1019200003', 'instagram', 'new', 'ONLINE_EGYPT', 0, '2020-01-01'),
       ('sb-l4', ?, 'مخفي', '1019200004', 'facebook', 'new', 'ONLINE_EGYPT', 1, NOW())`, [T, T, T, T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the range cuts the leads and the money; the money is EGP and paid only; hidden leads are not counted', { skip }, async () => {
  const today = new Date().toISOString().slice(0, 10);
  const month = (await get({ from: `${today.slice(0, 8)}01`, to: today })).body;
  assert.deepEqual(month.leads.map(row => [row.status, row.source, row.n]).sort(), [['converted', 'facebook', 1], ['new', 'facebook', 1]]);
  assert.equal(month.revenue, 2400, '1,000 EGP + 100 SAR as 1,400 EGP; the pending 500 and the 2020 payment are outside');
  assert.equal(month.payments, 2);
  assert.deepEqual(month.byStaff, [{ staffId: 'sb-a', name: 'منى', revenue: 2400, payments: 2 }]);
  assert.deepEqual(month.byItem, [{ id: 'sb-c1', name: 'كورس أ', revenue: 2400, payments: 2 }]);
});

test('without a start it is all time', { skip }, async () => {
  const all = (await get({})).body;
  assert.equal(all.revenue, 2700);
  assert.equal(all.leads.reduce((sum, row) => sum + row.n, 0), 3);
  assert.deepEqual(all.byStaff.map(row => row.name), ['منى', 'سارة']);
});
