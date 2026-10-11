'use strict';
/**
 * «التقرير الأسبوعي للفروع» against a real MariaDB (lib/weeklyBranchReport.js):
 * a week's money per branch in EGP, debts by age at the week's end, and each
 * rep's leads of the week that became paying clients. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-weekly-it';
let pool, buildWeeklyBranchReport;

async function clean() {
  for (const table of ['payments', 'expenses', 'subscribers', 'leads', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]);
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ buildWeeklyBranchReport } = require('../../lib/weeklyBranchReport'));
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('wk-rep', ?, 'منى', 'wk-rep@x.test', '01000000077', 'SALES', 1, '2025-01-01')`, [TENANT]);
  // Two leads handed to the rep in the week (Sat 3 – Fri 9 Oct 2026); one became a paying client.
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, branch, hidden, assigned_sales_id, assigned_at) VALUES
       ('wk-lead-1', ?, 'ليد ١', '1018880001', 'facebook', 'converted', 'DAQQI', 0, 'wk-rep', '2026-10-04 10:00:00'),
       ('wk-lead-2', ?, 'ليد ٢', '1018880002', 'facebook', 'new', 'DAQQI', 0, 'wk-rep', '2026-10-05 10:00:00'),
       ('wk-lead-3', ?, 'ليد ٣', '1018880003', 'facebook', 'new', 'DAQQI', 0, 'wk-rep', '2026-09-20 10:00:00')`,
    [TENANT, TENANT, TENANT]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, is_active, lead_id) VALUES
       ('wk-sub-1', ?, 'عميلة الدقي', '1018880001', 'DAQQI', 1, 'wk-lead-1'),
       ('wk-sub-2', ?, 'عميل السعودية', '966500000001', 'ONLINE_SAUDI', 1, NULL)`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, branch, course_id, amount, currency, fx_rate_to_egp, amount_egp, course_expected, date, status, is_installment) VALUES
       ('wk-p1', ?, 'wk-sub-1', 'DAQQI', NULL, 1000, 'EGP', 1, 1000, NULL, '2026-10-06', 'paid', 0),
       ('wk-p2', ?, 'wk-sub-2', NULL, NULL, 100, 'SAR', 13, 1300, 500, '2026-06-01', 'paid', 0),
       ('wk-p3', ?, 'wk-sub-2', NULL, NULL, 100, 'SAR', 13, 1300, NULL, '2026-10-08', 'paid', 1),
       ('wk-p4', ?, 'wk-sub-1', 'DAQQI', NULL, 999, 'EGP', 1, 999, NULL, '2026-10-10', 'paid', 0)`,
    [TENANT, TENANT, TENANT, TENANT]);
  await pool.query(
    `INSERT INTO expenses (id, tenant_id, description, amount, currency, amount_egp, date, branch_id) VALUES
       ('wk-e1', ?, 'إيجار', 400, 'EGP', 400, '2026-10-07', 'branch-daqqi')`, [TENANT]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the week\'s money per branch, in EGP at each row\'s own rate', { skip }, async () => {
  const report = await buildWeeklyBranchReport({ tenantId: TENANT, week: '2026-10-07' }, pool, { convert: async () => { throw new Error('unused'); } });
  assert.deepEqual([report.from, report.to], ['2026-10-03', '2026-10-09']);
  const daqqi = report.branches.find(row => row.branch === 'DAQQI');
  assert.deepEqual([daqqi.incomeEgp, daqqi.expensesEgp, daqqi.netEgp], [1000, 400, 600], 'Saturday the 10th is next week\'s');
  // No branch on the payment: the client's.
  assert.equal(report.branches.find(row => row.branch === 'ONLINE_SAUDI').incomeEgp, 1300);
});

test('debts by age at the week\'s end, and the rep\'s week of leads', { skip }, async () => {
  const report = await buildWeeklyBranchReport({ tenantId: TENANT, week: '2026-10-07' }, pool);
  const saudi = report.branches.find(row => row.branch === 'ONLINE_SAUDI');
  // 500 SAR agreed (6,500) less 1,300 paid on that course — booked 1 Jun: 90+.
  assert.deepEqual(saudi.aging.map(bucket => bucket.amountEgp), [0, 0, 0, 5200]);
  const daqqi = report.branches.find(row => row.branch === 'DAQQI');
  assert.deepEqual(daqqi.reps, [{ id: 'wk-rep', name: 'منى', assigned: 2, converted: 1, rate: 50 }]);
});
