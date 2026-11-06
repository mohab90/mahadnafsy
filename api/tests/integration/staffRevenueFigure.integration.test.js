'use strict';
/**
 * 6 Nov 2026: each rep's collected revenue, from the database. «مركز المبيعات» and «أداء الموظفين» added it up in the browser from the newest 500 orders and payments;
 * GET /api/admin/leads/staff-performance now carries it (revenueEgp), by the very rows and amount_egp that «أداء فريق المبيعات» gets from
 * /api/admin/reports/sales-performance, so the three screens name one figure. Against a real MariaDB: the two routes agree rep by rep, only paid money inside the range
 * counts (pending, deleted and earlier payments do not), a payment of another currency counts at its EGP amount, and an account that may not see money is not told.
 * Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-staff-revenue-it';
let pool, server, base, caller;

const accounts = {
  admin: { uid: 'sr-admin', email: 'sr-admin@x.t', name: 'مدير' },
  limited: { uid: 'sr-lim', email: 'sr-lim@x.t', name: 'محدود' },
};
const clean = async () => { for (const table of ['payments', 'subscribers', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {}); };
async function get(url) {
  const response = await fetch(`${base}${url}`);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, body };
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, permissions_json) VALUES
       ('sr-admin', ?, 'مدير', ?, '01033330001', 'ADMIN', 1, '2025-01-01', '[]'),
       ('sr-lim', ?, 'محدود', ?, '01033330002', 'OTHER', 1, '2025-01-01', ?),
       ('sr-s1', ?, 'مندوب ١', 'sr-s1@x.t', '01033330003', 'SALES', 1, '2025-01-01', '[]'),
       ('sr-s2', ?, 'مندوب ٢', 'sr-s2@x.t', '01033330004', 'SALES', 1, '2025-01-01', '[]')`,
    [T, accounts.admin.email, T, accounts.limited.email, JSON.stringify(['view_leads']), T, T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, is_active, client_code) VALUES ('sr-sub', ?, 'عميل', 1, 'SR1')", [T]);
  const pay = (id, staff, amount, currency, egp, date, status = 'paid', deleted = false) => pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, amount_egp, date, staff_id, status, payment_type, deleted_at)
     VALUES (?, ?, 'sr-sub', ?, ?, ?, ?, ?, ?, 'COURSE', ${deleted ? 'NOW()' : 'NULL'})`, [id, T, amount, currency, egp, date, staff, status]);
  await pay('sr-p1', 'sr-s1', 1000, 'EGP', 1000, '2026-10-05 10:00:00');
  await pay('sr-p2', 'sr-s1', 100, 'SAR', 1300, '2026-10-20 10:00:00');
  await pay('sr-p3', 'sr-s1', 500, 'EGP', 500, '2026-09-20 10:00:00');         // before the range
  await pay('sr-p4', 'sr-s1', 700, 'EGP', 700, '2026-10-21 10:00:00', 'pending');
  await pay('sr-p5', 'sr-s1', 900, 'EGP', 900, '2026-10-22 10:00:00', 'paid', true); // taken back
  await pay('sr-p6', 'sr-s2', 250, 'EGP', 250, '2026-10-02 10:00:00');

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T;
    if (caller) req.user = { ...caller, tenant_id: T, is_staff: true, mfa_verified: true, session_id: 's' };
    next();
  });
  app.use(require('../../routes/admin/leads'));
  app.use(require('../../routes/analytics/sales'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!ENABLED) return;
  if (server) await new Promise(resolve => server.close(resolve));
  await clean();
  await pool.end();
  setTimeout(() => process.exit(), 300).unref();
});

test('a rep\'s revenue is what the sales team report names, counting only paid money inside the range', { skip }, async () => {
  caller = accounts.admin;
  const mine = (await get('/api/admin/leads/staff-performance?from=2026-10-01')).body;
  const report = (await get('/api/admin/reports/sales-performance?from=2026-10-01&to=2026-12-31')).body;
  assert.equal(mine.byStaff['sr-s1'].revenueEgp, 2300, '1,000 + the 100 SAR at its 1,300 EGP; not the earlier, pending or taken-back ones');
  assert.equal(mine.byStaff['sr-s2'].revenueEgp, 250);
  for (const rep of report.staff.filter(row => ['sr-s1', 'sr-s2'].includes(row.id))) {
    assert.equal(mine.byStaff[rep.id].revenueEgp, Number(rep.revenue_egp), `${rep.id} agrees with the report`);
  }
  const everything = (await get('/api/admin/leads/staff-performance')).body;
  assert.equal(everything.byStaff['sr-s1'].revenueEgp, 2800, 'with no range the earlier payment counts too');
});

test('an account that may not see money is given the lead counts and no revenue', { skip }, async () => {
  caller = accounts.limited;
  const answer = await get('/api/admin/leads/staff-performance?from=2026-10-01');
  assert.equal(answer.status, 200);
  assert.equal(Object.values(answer.body.byStaff).some(entry => 'revenueEgp' in entry), false);
});
