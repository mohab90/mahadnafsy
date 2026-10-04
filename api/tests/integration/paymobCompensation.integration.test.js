'use strict';
/**
 * A course paid online pays the sales rep and the instructor exactly as the
 * same payment at the desk does — the queued job runs lib/paymentCompensation.js.
 * Against a real MariaDB; runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-paymob-comp-it';
let pool; let calc;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  calc = require('../../lib/commissionCalc');
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, commission_rate) VALUES
       ('st-rep', ?, 'مندوبة', 'rep@example.test', '1012000001', 'SALES', 1, '2025-01-01', 5),
       ('st-dr', ?, 'د. مدرّب', 'dr@example.test', '1012000002', 'INSTRUCTOR', 1, '2025-01-01', 0)`, [TENANT, TENANT]);
  await pool.query("INSERT INTO instructor_rates (id, tenant_id, staff_id, revenue_share_pct) VALUES (UUID(), ?, 'st-dr', 30)", [TENANT]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, instructor_id)
     VALUES ('co-1', ?, 'كورس', '', '', 'د. مدرّب', '', 'GENERAL', 'RECORDED', 'st-dr')`, [TENANT]);
  // A rule that ran until the end of September, and a lower one from October:
  // the payment is from September, the job runs now.
  await pool.query(
    `INSERT INTO commission_rules (id, tenant_id, name, staff_id, calc_type, percentage_value, effective_from, effective_to, is_active, priority) VALUES
       (UUID(), ?, 'سبتمبر', 'st-rep', 'PERCENTAGE', 10, '2026-09-01', '2026-09-30', 1, 1),
       (UUID(), ?, 'أكتوبر', 'st-rep', 'PERCENTAGE', 2, '2026-10-01', NULL, 1, 1)`, [TENANT, TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, assigned_sales_id) VALUES ('sub-1', ?, 'عميلة', '1012000003', 'st-rep')", [TENANT]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, payment_type, payment_method, status, date, source)
     VALUES ('paymob-o1', ?, 'sub-1', 'co-1', 2000, 2000, 'EGP', 'COURSE', 'online_paymob', 'paid', '2026-09-20', 'paymob'),
            ('paymob-o2', ?, 'sub-1', 'co-1', 900, 900, 'EGP', 'COURSE', 'online_paymob', 'refunded', '2026-09-21', 'paymob')`, [TENANT, TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  for (const table of ['crm_commissions', 'instructor_fees', 'payments', 'subscribers', 'commission_rules', 'courses', 'instructor_rates', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
  await pool.end();
});

test('an online course payment pays the rep at its own date\'s rule and the instructor their share, once', { skip }, async () => {
  assert.deepEqual(await calc.recordCommissionForPayment({ tenantId: TENANT, paymentId: 'paymob-o1' }), { written: true });
  await calc.recordCommissionForPayment({ tenantId: TENANT, paymentId: 'paymob-o1' }); // the outbox retries
  const [commissions] = await pool.query('SELECT staff_id, commission_amount FROM crm_commissions WHERE tenant_id=?', [TENANT]);
  assert.deepEqual(commissions.map(c => [c.staff_id, Number(c.commission_amount)]), [['st-rep', 200]], '10% — September\'s rule, not October\'s 2%');
  const [fees] = await pool.query('SELECT staff_id, total_amount FROM instructor_fees WHERE tenant_id=?', [TENANT]);
  assert.deepEqual(fees.map(f => [f.staff_id, Number(f.total_amount)]), [['st-dr', 600]], 'the instructor\'s 30%');
});

test('a payment refunded before the job ran is a result, not a failure to retry', { skip }, async () => {
  assert.deepEqual(await calc.recordCommissionForPayment({ tenantId: TENANT, paymentId: 'paymob-o2' }), { written: false, reason: 'payment_not_paid' });
});
