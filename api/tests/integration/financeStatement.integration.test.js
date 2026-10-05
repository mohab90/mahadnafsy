'use strict';
/**
 * The period statement (lib/financeStatement.js): collected less refunds less
 * expenses, beside the period before it, what the team is still owed, and the
 * breakdowns — against a real MariaDB. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-statement-it';
let pool; let router;

async function statement(query, staff = null) {
  const layer = router.stack.find(item => item.route?.path === '/api/admin/finance/statement' && item.route.methods.get);
  assert.ok(layer, 'statement route');
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await layer.route.stack.at(-1).handle({
    params: {}, query, body: {}, headers: {}, tenantId: TENANT, user: { uid: 'u', email: 'x@example.test' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}

async function clean() {
  for (const table of ['refunds', 'crm_commissions', 'instructor_fees', 'expenses', 'payments', 'subscribers', 'courses']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

const pay = (id, sub, date, amountEgp, extra = {}) => ({
  id, subscriber_id: sub, date, amount: amountEgp, currency: 'EGP', fx_rate_to_egp: 1, amount_egp: amountEgp,
  payment_type: 'COURSE', course_id: 'co-st-1', status: 'paid', branch: 'DAQQI', branch_id: 'branch-daqqi', payment_method: 'كاش', ...extra,
});

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  router = require('../../routes/finance');
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type)
     VALUES ('co-st-1', ?, 'دبلومة العلاج المعرفي', '', '', '', '', 'GENERAL', 'RECORDED')`, [TENANT]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES
       ('sub-st-1', ?, 'عميل 1', '1017000001', 'DAQQI', 'branch-daqqi'),
       ('sub-st-2', ?, 'عميل 2', '1017000002', 'ONLINE_EGYPT', 'branch-online-egypt')`, [TENANT, TENANT]);
  const rows = [
    pay('p-st-1', 'sub-st-1', '2026-09-05 10:00:00', 3000, { course_expected: 6000 }),
    pay('p-st-2', 'sub-st-2', '2026-09-20 12:00:00', 1500, { branch: 'ONLINE_EGYPT', branch_id: 'branch-online-egypt', payment_method: 'فودافون كاش' }),
    pay('p-st-3', 'sub-st-2', '2026-09-21 12:00:00', 999, { status: 'pending' }),
    pay('p-st-4', 'sub-st-1', '2026-08-10 12:00:00', 2000),
  ];
  for (const row of rows) {
    const cols = Object.keys(row);
    await pool.query(`INSERT INTO payments (tenant_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`, [TENANT, ...Object.values(row)]);
  }
  await pool.query(
    `INSERT INTO expenses (id, tenant_id, description, amount, currency, amount_egp, category, date, branch_id) VALUES
       ('e-st-1', ?, 'إيجار', 1000, 'EGP', 1000, 'RENT', '2026-09-01 09:00:00', 'branch-daqqi'),
       ('e-st-2', ?, 'إعلانات', 300, 'EGP', 300, 'MARKETING', '2026-09-15 09:00:00', 'branch-online-egypt')`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO refunds (id, tenant_id, payment_id, subscriber_id, amount, currency, reason, status, created_at, resolved_at) VALUES
       ('r-st-1', ?, 'p-st-2', 'sub-st-2', 200, 'EGP', 'جزئي', 'done', '2026-09-22 10:00:00', '2026-09-22 11:00:00'),
       ('r-st-2', ?, 'p-st-2', 'sub-st-2', 999, 'EGP', 'مرفوض', 'rejected', '2026-09-22 10:00:00', NULL)`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO crm_commissions (id, tenant_id, staff_id, payment_id, payment_amount, commission_amount, month, year, status, created_at, branch_id) VALUES
       ('c-st-1', ?, 'st-x', 'p-st-1', 3000, 150, 9, 2026, 'PENDING', '2026-09-05 10:00:00', 'branch-daqqi'),
       ('c-st-2', ?, 'st-x', 'p-st-2', 1500, 75, 9, 2026, 'PAID', '2026-09-20 10:00:00', 'branch-online-egypt')`, [TENANT, TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('September: collected, less refunds and expenses, and what the team is still owed', { skip }, async () => {
  const res = await statement({ from: '2026-09-01', to: '2026-09-30' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const s = res.body;
  assert.deepEqual(s.previousPeriod, { from: '2026-08-02', to: '2026-08-31' });
  assert.equal(s.current.collected, 4500);          // the pending 999 is not money in
  assert.equal(s.current.payments, 2);
  assert.equal(s.current.payingClients, 2);
  assert.equal(s.current.refunds, 200);              // the rejected one is not
  assert.equal(s.current.expenses, 1300);
  assert.equal(s.current.operating, 3000);
  assert.equal(s.current.teamPending, 150);          // the paid commission is in payroll already
  assert.equal(s.current.afterTeam, 2850);
  assert.equal(s.previous.collected, 2000);
  assert.deepEqual(s.byBranch.map(r => [r.key, r.amount]), [['DAQQI', 3000], ['ONLINE_EGYPT', 1500]]);
  assert.deepEqual(s.expensesByCategory.map(r => r.key), ['RENT', 'MARKETING']);
  assert.equal(s.topItems[0].name, 'دبلومة العلاج المعرفي');
  assert.equal(s.series.unit, 'day');
  assert.equal(s.series.points.length, 30);
  assert.equal(s.series.points.find(p => p.key === '2026-09-05').collected, 3000);
  assert.equal(s.receivables.total, 1000);           // 6000 agreed, 3000 + 2000 paid (receivables are all-time)
});

test('a branch reads only its own money', { skip }, async () => {
  const res = await statement({ from: '2026-09-01', to: '2026-09-30', branch: 'DAQQI' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.current.collected, 3000);
  assert.equal(res.body.current.expenses, 1000);
  assert.equal(res.body.current.refunds, 0);
  assert.equal(res.body.instructorFeesIncluded, false);
});

test('a year reads by month, and a bad range is refused', { skip }, async () => {
  const year = await statement({ from: '2026-01-01', to: '2026-12-31' });
  assert.equal(year.body.series.unit, 'month');
  assert.equal(year.body.series.points.length, 12);
  const bad = await statement({ from: '2026-09-30', to: '2026-09-01' });
  assert.equal(bad.statusCode, 400);
});
