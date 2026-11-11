'use strict';
/**
 * 11 Nov 2026, the owner: certificate money is COLLECTION, not sales. A rep's revenue, bookings and target in the HR reports count course and track money only; a collector's
 * figures include the certificates he collected (lib/repRevenue.js). Real MariaDB, the real HR performance report and the staff profile's career figures.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-rep-revenue-it';
let pool; let reports; let attendance;

async function clean() {
  for (const table of ['payments', 'subscribers', 'courses', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}
async function call(router, method, path, { params = {}, query = {} } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body: {}, query, headers: {}, tenantId: T, user: { uid: 'u', email: 'hr-rev@example.test' }, staffRecord: { id: 'st-rev-hr', role: 'hr', permissions_json: '["view_hr","manage_hr"]' }, isSuperAdmin: true, hrReach: { all: true }, ip: '1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  reports = require('../../routes/hr/reports');
  attendance = require('../../routes/hr/attendance');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, bonus_scheme) VALUES
       ('st-rev-rep', ?, 'مندوب', 'rev-rep@x.t', '1019000001', 'SALES', 1, '2025-01-01', 'SALES_BOOKINGS'),
       ('st-rev-coll', ?, 'محصل', 'rev-coll@x.t', '1019000002', 'COLLECTION', 1, '2025-01-01', 'COLLECTION')`, [T, T]);
  for (const id of ['crs-rev', 'crs-rev2', 'crs-rev3']) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
       VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', 1000)`, [id, T, `كورس ${id}`]);
  }
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('sub-rev', ?, 'عميل', '1019000009')", [T]);
  const pay = (id, staff, amount, type, course = 'crs-rev') => pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, staff_id, course_id, amount, amount_egp, currency, status, payment_type, date) VALUES (?, ?, 'sub-rev', ?, ?, ?, ?, 'EGP', 'paid', ?, '2027-01-10')`,
    [id, T, staff, course, amount, amount, type]);
  await pay('p-rep-course', 'st-rev-rep', 1000, 'COURSE');
  await pay('p-rep-cert', 'st-rev-rep', 300, 'CERTIFICATE');
  await pay('p-coll-course', 'st-rev-coll', 500, 'COURSE', 'crs-rev2');
  await pay('p-coll-cert', 'st-rev-coll', 200, 'CERTIFICATE', 'crs-rev3');
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the HR performance report: a rep\'s revenue and bookings are course money only, a collector\'s include the certificates he collected', { skip }, async () => {
  const report = await call(reports, 'get', '/api/admin/hr/reports/performance', { query: { month: '2027-01' } });
  assert.equal(report.statusCode, 200, JSON.stringify(report.body));
  const rep = report.body.find(row => row.staff_id === 'st-rev-rep');
  const collector = report.body.find(row => row.staff_id === 'st-rev-coll');
  assert.equal(rep.revenue, 1000, 'the 300 certificate is collection, not the rep\'s sales');
  assert.equal(rep.bookings_count, 1, 'a certificate is no booking');
  assert.equal(rep.orders_count, 1);
  assert.equal(collector.revenue, 700, 'a collector collects the certificate too');
});

test('the KPI of one employee follows the same rule', { skip }, async () => {
  const rep = await call(attendance, 'get', '/api/admin/hr/kpi/:staffId', { params: { staffId: 'st-rev-rep' }, query: { month: '1', year: '2027' } });
  assert.equal(rep.statusCode, 200, JSON.stringify(rep.body));
  assert.equal(Number(rep.body.actuals.revenue_generated), 1000);
  assert.equal(Number(rep.body.actuals.sales_count), 1);
  const collector = await call(attendance, 'get', '/api/admin/hr/kpi/:staffId', { params: { staffId: 'st-rev-coll' }, query: { month: '1', year: '2027' } });
  assert.equal(Number(collector.body.actuals.revenue_generated), 700);
});
