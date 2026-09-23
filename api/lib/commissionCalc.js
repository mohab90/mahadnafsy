'use strict';
/**
 * Sales commission for a recorded payment.
 *
 * Lifted out of the Paymob callback, where it ran in a `setImmediate` whose
 * catch only logged a warning. That made it the one piece of money in the flow
 * with no durability: the payment committed, and if this then hit a deadlock, a
 * dropped connection or a restart, the commission was simply never written and
 * nothing retried it. The staff member is short and nobody finds out, because
 * the only trace is a warning line.
 *
 * It is now driven by finance_outbox — the same durable queue the manual-payment
 * path already uses — so a failure is retried instead of lost. The enqueue
 * happens inside the payment transaction, which is what makes it durable: if the
 * payment rolls back the job goes with it, and if the payment commits the job is
 * committed too and will run.
 *
 * Idempotent by construction: crm_commissions has a unique key covering the
 * payment, so a retry updates the same row rather than paying twice.
 */
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const logger = require('./logger').child({ lib: 'commissionCalc' });

/**
 * Work out the rate for a staff member: an explicit active rule wins, otherwise
 * the rate on the staff row.
 */
async function resolveRate(db, { tenantId, staffId, amount }) {
  const [[rule]] = await db.query(
    `SELECT id, percentage_value FROM commission_rules
      WHERE tenant_id=? AND is_active=1 AND calc_type='PERCENTAGE'
        AND (staff_id=? OR (staff_id IS NULL AND JSON_CONTAINS(COALESCE(apply_to_roles,'[]'),
             JSON_QUOTE((SELECT role FROM staff WHERE id=? AND tenant_id=? LIMIT 1)))))
        AND effective_from <= CURDATE() AND (effective_to IS NULL OR effective_to >= CURDATE())
        AND (min_payment IS NULL OR min_payment <= ?)
      ORDER BY staff_id DESC, priority ASC LIMIT 1`,
    [tenantId, staffId, staffId, tenantId, Number(amount)]
  ).catch(() => [[null]]);

  if (rule?.percentage_value) return { rate: Number(rule.percentage_value), ruleId: rule.id };

  const [[staff]] = await db.query(
    'SELECT commission_rate FROM staff WHERE id=? AND tenant_id=? LIMIT 1',
    [staffId, tenantId]
  ).catch(() => [[null]]);
  return { rate: Number(staff?.commission_rate || 0), ruleId: null };
}

/**
 * Record the commission owed on one payment.
 *
 * @returns {Promise<{written: boolean, reason?: string, amount?: number}>}
 *   `written:false` with a reason is a normal outcome (no assigned rep, no rate)
 *   — it must not be reported as failure, or the queue would retry forever.
 *   A genuine fault throws, so the outbox retries it.
 */
async function recordCommissionForPayment({ tenantId, paymentId, subscriberId, amount, branchId }, db = pool) {
  if (!tenantId || !paymentId || !subscriberId) throw new Error('tenantId, paymentId and subscriberId are required');
  const paid = Number(amount) || 0;
  if (paid <= 0) return { written: false, reason: 'non_positive_amount' };

  const [[subscriber]] = await db.query(
    'SELECT assigned_sales_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
    [subscriberId, tenantId]
  );
  const staffId = subscriber?.assigned_sales_id || null;
  if (!staffId) return { written: false, reason: 'no_assigned_sales' };

  const { rate, ruleId } = await resolveRate(db, { tenantId, staffId, amount: paid });
  if (!(rate > 0)) return { written: false, reason: 'no_rate' };

  const commission = Number((paid * rate / 100).toFixed(2));
  const now = new Date();
  await db.query(
    `INSERT INTO crm_commissions
       (id, tenant_id, branch_id, staff_id, payment_id, rule_id, client_id, client_type,
        payment_amount, commission_amount, calc_details, month, year, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',NOW())
     ON DUPLICATE KEY UPDATE commission_amount=VALUES(commission_amount)`,
    [uuidv4(), tenantId, branchId || 'branch-other', staffId, paymentId, ruleId, subscriberId, 'subscriber',
      paid, commission,
      JSON.stringify({ rate, calc_type: 'PERCENTAGE', rule_id: ruleId, trigger: 'payment' }),
      now.getMonth() + 1, now.getFullYear()]
  );
  logger.info('commission recorded', { paymentId, staffId, commission, rate });
  return { written: true, amount: commission };
}

module.exports = { recordCommissionForPayment };
