'use strict';
/**
 * Paying a scheduled instalment pays the rep's commission and the instructor's
 * share, as every other paid payment does. Against a real MariaDB; runs only
 * with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-installment-it';
let pool; let router;

async function pay(index, body) {
  const layer = router.stack.find(item => item.route?.path === '/api/admin/installment-plans/:planId/entries/:index/pay');
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await layer.route.stack.at(-1).handle({
    params: { planId: 'plan-1', index: String(index) }, body, query: {}, headers: {}, tenantId: TENANT,
    user: { uid: 'u', email: 'desk@example.test' }, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/installments');
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, commission_rate) VALUES
       ('st-rep-i', ?, 'مندوب', 'rep-i@example.test', '1014000001', 'SALES', 1, '2025-01-01', 5),
       ('st-dr-i', ?, 'محاضرة', 'dr-i@example.test', '1014000002', 'INSTRUCTOR', 1, '2025-01-01', 0)`, [TENANT, TENANT]);
  await pool.query("INSERT INTO instructor_rates (id, tenant_id, staff_id, revenue_share_pct) VALUES (UUID(), ?, 'st-dr-i', 20)", [TENANT]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, instructor_id)
     VALUES ('co-i-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 'st-dr-i')`, [TENANT]);
  await pool.query(
    "INSERT INTO subscribers (id, tenant_id, name, phone, branch, assigned_sales_id) VALUES ('sub-i-1', ?, 'عميل', '1014000003', 'ONLINE_EGYPT', 'st-rep-i')", [TENANT]);
  await pool.query(
    `INSERT INTO installment_plans (id, tenant_id, subscriber_id, title, total_amount, currency, installments_count, installment_amounts, due_dates, course_id)
     VALUES ('plan-1', ?, 'sub-i-1', 'خطة', 3000, 'EGP', 2, '[1500,1500]', '["2026-10-01","2026-11-01"]', 'co-i-1')`, [TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await pool.query("DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)", [TENANT]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'crm_commissions', 'instructor_fees', 'entitlement_events', 'enrollments',
    'payments', 'installment_plans', 'subscribers', 'courses', 'instructor_rates', 'staff', 'outbox']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
  await pool.end();
});

test('an instalment paid at the desk pays the rep 5% and the instructor 20% of it', { skip }, async () => {
  const res = await pay(0, { amount: 1500, paymentMethod: 'كاش' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [[commission]] = await pool.query('SELECT staff_id, commission_amount FROM crm_commissions WHERE tenant_id=?', [TENANT]);
  assert.deepEqual([commission?.staff_id, Number(commission?.commission_amount)], ['st-rep-i', 75]);
  const [[fee]] = await pool.query('SELECT staff_id, total_amount FROM instructor_fees WHERE tenant_id=?', [TENANT]);
  assert.deepEqual([fee?.staff_id, Number(fee?.total_amount)], ['st-dr-i', 300]);
});
