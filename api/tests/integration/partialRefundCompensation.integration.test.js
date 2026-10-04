'use strict';
/**
 * A partial refund takes back the same share of the instructor's fee as of the
 * rep's commission, and the refund that finishes the payment off leaves no fee
 * to pay. Against a real MariaDB; runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-partial-refund-it';
let pool; let refunds;

const inTx = async fn => {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const out = await fn(conn); await conn.commit(); return out; }
  catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
};
const state = async () => {
  const [[fee]] = await pool.query("SELECT status, total_amount FROM instructor_fees WHERE tenant_id=? AND source_payment_id='pay-pr-1'", [TENANT]);
  const [[commission]] = await pool.query("SELECT status, commission_amount FROM crm_commissions WHERE tenant_id=? AND payment_id='pay-pr-1'", [TENANT]);
  return { fee: [fee.status, Number(fee.total_amount)], commission: [commission.status, Number(commission.commission_amount)] };
};

// Rows a run left behind (an interrupted run, a failed delete) must not
// break the next one: cleared before as well as after.
async function clean() {
  await pool.query("DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)", [TENANT]).catch(() => {});
  for (const table of ['journal_entries', 'refunds', 'payment_audit_log', 'crm_commissions', 'instructor_fees', 'entitlement_events', 'enrollments', 'payments', 'subscribers', 'employee_bonuses', 'courses']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  refunds = require('../../lib/refunds');
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type)
     VALUES ('co-pr-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED')`, [TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('sub-pr-1', ?, 'عميلة', '1013000001')", [TENANT]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, payment_type, payment_method, status, date)
     VALUES ('pay-pr-1', ?, 'sub-pr-1', 'co-pr-1', 2000, 2000, 'EGP', 'COURSE', 'cash', 'paid', CURDATE())`, [TENANT]);
  await pool.query(
    "INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, status, enrolled_at) VALUES ('enr-pr-1', ?, 'sub-pr-1', 'co-pr-1', 'active', NOW())", [TENANT]);
  await pool.query(
    `INSERT INTO instructor_fees (id, tenant_id, staff_id, course_id, source_payment_id, fee_type, fixed_amount, total_amount, currency, period_month, period_year, status)
     VALUES (UUID(), ?, 'st-dr', 'co-pr-1', 'pay-pr-1', 'fixed', 600, 600, 'EGP', MONTH(CURDATE()), YEAR(CURDATE()), 'approved')`, [TENANT]);
  await pool.query(
    `INSERT INTO crm_commissions (id, tenant_id, branch_id, staff_id, payment_id, client_id, client_type, payment_amount, commission_amount, month, year, status)
     VALUES (UUID(), ?, 'branch-other', 'st-rep', 'pay-pr-1', 'sub-pr-1', 'subscriber', 2000, 200, MONTH(CURDATE()), YEAR(CURDATE()), 'PENDING')`, [TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

const refund = amount => inTx(conn => refunds.applyRefundReversal({
  paymentId: 'pay-pr-1', subscriberId: 'sub-pr-1', refundAmount: amount, refundCurrency: 'EGP', tenantId: TENANT, actor: 'test',
}, conn));

test('half the money back: half the commission and half the instructor\'s fee', { skip }, async () => {
  const result = await refund(1000);
  assert.equal(result.partial, true);
  assert.deepEqual(await state(), { fee: ['approved', 300], commission: ['PENDING', 100] });
  const [[enrollment]] = await pool.query("SELECT status FROM enrollments WHERE id='enr-pr-1'");
  assert.equal(enrollment.status, 'active', 'half paid for, the course stays open');
});

test('the rest back: nothing left to pay the instructor', { skip }, async () => {
  const result = await refund(1000);
  assert.equal(result.fullyRefunded, true);
  assert.deepEqual(await state(), { fee: ['rejected', 0], commission: ['PENDING', 0] });
  const [[enrollment]] = await pool.query("SELECT status FROM enrollments WHERE id='enr-pr-1'");
  assert.equal(enrollment.status, 'revoked', 'nothing paid for any more: the course closes, as on a full refund');
});
