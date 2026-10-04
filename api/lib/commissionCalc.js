'use strict';
/**
 * Sales commission (and the instructor's share) for a payment the Paymob
 * callback recorded.
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
 * The rule itself is lib/paymentCompensation.js, the one every other payment
 * path runs. This file used to carry its own copy, and the two had drifted: the
 * copy wrote no instructor_fees at all — an online course payment never paid its
 * instructor's share, the same payment at the desk did — took the commission
 * rule in force on the day the job ran rather than on the payment's date, and
 * credited only the client's rep, never the payment's own employee.
 *
 * Idempotent: crm_commissions and instructor_fees each have a unique key on the
 * payment, and the writes are ON DUPLICATE KEY UPDATE, so a retry updates the
 * same rows rather than paying twice.
 */
const { pool } = require('./db');
const logger = require('./logger').child({ lib: 'commissionCalc' });
const { recordPaymentCompensation } = require('./paymentCompensation');

/**
 * @returns {Promise<{written: boolean, reason?: string}>}
 *   `written:false` with a reason is a normal outcome (the payment was refunded
 *   or deleted before the job ran, or holds no amount) — it must not be
 *   reported as failure, or the queue would retry it until it is marked dead.
 *   A genuine fault throws, so the outbox retries it.
 */
async function recordCommissionForPayment({ tenantId, paymentId }, db = pool) {
  if (!tenantId || !paymentId) throw new Error('tenantId and paymentId are required');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[payment]] = await conn.query(
      `SELECT status, amount_egp FROM payments
        WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [paymentId, tenantId]
    );
    if (!payment || !['paid', 'confirmed'].includes(String(payment.status || '').toLowerCase())) {
      await conn.rollback();
      return { written: false, reason: 'payment_not_paid' };
    }
    if (!(Number(payment.amount_egp) > 0)) {
      await conn.rollback();
      return { written: false, reason: 'non_positive_amount' };
    }
    await recordPaymentCompensation({ paymentId, tenantId, actor: 'paymob' }, conn);
    await conn.commit();
    logger.info('payment compensation recorded', { paymentId });
    return { written: true };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { recordCommissionForPayment };
