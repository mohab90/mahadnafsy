'use strict';
/**
 * Owner's decision of 11 Nov 2026: certificate money is COLLECTION, not SALES. A rep's revenue, the sales performance and breakdown
 * reports, the marketing overview and campaign revenue, the goals' actual, «أداء الموظفين» and the team report count course and track
 * money only (lib/salesMoney.js). One rep, one client, four payments — 1,000 course, 300 untyped (old), 200 certificate, 50 carneh —
 * and every figure must read 1,300. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-sales-cert-it';
const { cairoToday } = require('../../lib/dates');
let pool;

async function call(router, path, query = {}) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods.get);
  assert.ok(layer, `no GET ${path}`);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query, body: {}, headers: {}, tenantId: T, user: { uid: 'admin' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}
async function clean() {
  for (const table of ['payments', 'leads', 'subscribers', 'sales_goals', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  const today = cairoToday();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('cm-rep', ?, 'منى', 'cm-rep@x.t', '1019000011', 'SALES', 1, '2025-01-01')`, [T]);
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, branch, hidden, assigned_sales_id) VALUES ('cm-lead', ?, 'ليد', '1019200011', 'facebook', 'converted', 'ONLINE_EGYPT', 0, 'cm-rep')`, [T]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, assigned_sales_id, lead_id) VALUES ('cm-sub', ?, 'CM1', 'عميل', '1019100011', 'ONLINE_EGYPT', 'cm-rep', 'cm-lead')`, [T]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, staff_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, date) VALUES
       ('cm-p1', ?, 'cm-sub', 'cm-rep', 1000, 'EGP', 1, 1000, 'COURSE', 'paid', ?),
       ('cm-p2', ?, 'cm-sub', 'cm-rep', 300, 'EGP', 1, 300, NULL, 'paid', ?),
       ('cm-p3', ?, 'cm-sub', 'cm-rep', 200, 'EGP', 1, 200, 'CERTIFICATE', 'paid', ?),
       ('cm-p4', ?, 'cm-sub', 'cm-rep', 50, 'EGP', 1, 50, 'CARNEH', 'paid', ?)`, [T, today, T, today, T, today, T, today]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); setTimeout(() => process.exit(), 300).unref(); } });

test('sales performance, breakdown, marketing overview and goals count 1,300 — the certificate and the carneh are collection', { skip }, async () => {
  const sales = require('../../routes/analytics/sales');
  const today = cairoToday();
  const month = `${today.slice(0, 8)}01`;
  const performance = await call(sales, '/api/admin/reports/sales-performance', { from: month, to: today });
  assert.equal(Number(performance.staff.find(row => row.id === 'cm-rep').revenue_egp), 1300);
  const breakdown = await call(sales, '/api/admin/reports/sales-breakdown', { from: month, to: today });
  assert.equal(breakdown.revenue, 1300);
  assert.equal(breakdown.payments, 2);
  assert.equal(breakdown.byStaff.find(row => row.staffId === 'cm-rep').revenue, 1300);
  const overview = await call(sales, '/api/admin/marketing/overview', { range: 'month' });
  assert.equal(overview.current.revenue, 1300);
  assert.equal(overview.daily.reduce((sum, day) => sum + day.revenue, 0), 1300, 'the daily line agrees with the total');
  const goals = await call(sales, '/api/admin/sales-goals/vs-actual', { period: today.slice(0, 7) });
  assert.equal(goals.actual.revenue, 1300);
});

test('«أداء الموظفين», the rep\'s revenue, the campaign revenue and the team report agree: 1,300', { skip }, async () => {
  const performance = await call(require('../../routes/admin/leads/insights'), '/api/admin/leads/staff-performance', { from: `${cairoToday().slice(0, 8)}01` });
  assert.equal(performance.byStaff['cm-rep'].revenueEgp, 1300);
  const rep = await call(require('../../routes/admin/leads/insights'), '/api/admin/leads/rep-revenue', { month: cairoToday().slice(0, 7) });
  assert.equal(Math.round(rep.byStaff['cm-rep']), 1300);
  const campaign = await call(require('../../routes/analytics/campaigns'), '/api/admin/reports/campaign', { from: `${cairoToday().slice(0, 8)}01`, to: cairoToday() });
  assert.equal(Number(campaign.revenue_by_source.find(row => row.source === 'facebook').revenue), 1300);
  const team = await call(require('../../routes/crm-advanced'), '/api/admin/crm/team-report', { from: cairoToday(), to: cairoToday() });
  assert.equal(Math.round(Number(team.reps.find(row => row.id === 'cm-rep').moneyEgp)), 1300);
  const { buildSalesPulse } = require('../../lib/salesPulse');
  const pulse = await buildSalesPulse({ tenantId: T, staffId: 'cm-rep' });
  assert.equal(Math.round(pulse.month.moneyEgp), 1300);
  assert.deepEqual(pulse.recent.filter(row => row.kind !== 'lead').map(row => row.amountEgp).sort((a, b) => a - b), [300, 1000]);
});
