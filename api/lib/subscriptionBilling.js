'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const logger = require('./logger').child({ lib: 'subscription-billing' });

function nextBillingDate(currentDate, billingCycle) {
  const dateOnly = String(currentDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    throw new Error('invalid subscription billing date');
  }
  const current = new Date(`${dateOnly}T12:00:00Z`);
  if (!Number.isFinite(current.getTime()) || current.toISOString().slice(0, 10) !== dateOnly) {
    throw new Error('invalid subscription billing date');
  }

  const monthsToAdd = billingCycle === 'monthly'
    ? 1
    : billingCycle === 'quarterly'
      ? 3
      : billingCycle === 'yearly'
        ? 12
        : 0;
  if (!monthsToAdd) throw new Error('invalid subscription billing cycle');

  // Move from day 1 to avoid JavaScript rolling 31 January into March,
  // then clamp to the last valid day in the target month.
  const originalDay = current.getUTCDate();
  current.setUTCDate(1);
  current.setUTCMonth(current.getUTCMonth() + monthsToAdd);
  const lastTargetDay = new Date(Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth() + 1,
    0
  )).getUTCDate();
  current.setUTCDate(Math.min(originalDay, lastTargetDay));
  return current.toISOString().slice(0, 10);
}

async function billOneSubscription(subscriptionId, today) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[subscription]] = await conn.query(
      `SELECT ss.id, ss.tenant_id, ss.subscriber_id, ss.plan_id, ss.next_billing_date,
              sp.price, sp.billing_cycle, sp.name AS plan_name,
              s.branch, s.branch_id
       FROM subscriber_subscriptions ss
       JOIN subscription_plans sp
         ON sp.id=ss.plan_id AND sp.tenant_id=ss.tenant_id AND sp.is_active=1
       JOIN subscribers s
         ON s.id=ss.subscriber_id AND s.tenant_id=ss.tenant_id
        AND s.is_active=1 AND s.deleted_at IS NULL
       WHERE ss.id=? AND ss.status='active' AND ss.auto_renew=1
         AND ss.next_billing_date<=?
       FOR UPDATE`,
      [subscriptionId, today]
    );
    if (!subscription) {
      await conn.rollback();
      return { skipped: true };
    }

    const amount = Number(subscription.price);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`invalid subscription price for plan ${subscription.plan_id}`);
    }
    const dueDate = String(subscription.next_billing_date).slice(0, 10);
    const transactionId = `subscription:${subscription.tenant_id}:${subscription.id}:${dueDate}`;
    const paymentId = uuidv4();
    const [insert] = await conn.query(
      `INSERT IGNORE INTO payments
         (id, tenant_id, subscriber_id, branch, branch_id, amount, currency,
          payment_type, payment_method, transaction_id, date, status, note, source, item_title)
       VALUES (?, ?, ?, ?, ?, ?, 'EGP', 'OTHER', 'subscription', ?, NOW(), 'pending', ?, 'subscription', ?)`,
      [
        paymentId,
        subscription.tenant_id,
        subscription.subscriber_id,
        subscription.branch || null,
        subscription.branch_id || null,
        amount,
        transactionId,
        `Auto-billing subscription ${subscription.id} due ${dueDate}`,
        subscription.plan_name || `Subscription plan ${subscription.plan_id}`,
      ]
    );
    if (insert.affectedRows !== 1) {
      const [[existingPayment]] = await conn.query(
        `SELECT id FROM payments
         WHERE tenant_id=? AND transaction_id=? AND deleted_at IS NULL
         LIMIT 1`,
        [subscription.tenant_id, transactionId]
      );
      if (!existingPayment) throw new Error('subscription billing idempotency conflict');
    }

    const nextDate = nextBillingDate(dueDate, subscription.billing_cycle);
    await conn.query(
      `UPDATE subscriber_subscriptions
       SET next_billing_date=?
       WHERE id=? AND tenant_id=? AND next_billing_date=?`,
      [nextDate, subscription.id, subscription.tenant_id, dueDate]
    );
    await conn.commit();
    return { created: insert.affectedRows === 1, tenantId: subscription.tenant_id };
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.warn('subscription billing failed', { subscriptionId, error: error.message });
    throw error;
  } finally {
    conn.release();
  }
}

async function runSubscriptionBilling({ limit = 500 } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const [due] = await pool.query(
    `SELECT ss.id
     FROM subscriber_subscriptions ss
     WHERE ss.tenant_id IS NOT NULL
       AND ss.status='active' AND ss.auto_renew=1 AND ss.next_billing_date<=?
     ORDER BY ss.next_billing_date, ss.id
     LIMIT ?`,
    [today, safeLimit]
  );
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const result = await billOneSubscription(row.id, today);
      if (result.created) created++;
      else skipped++;
    } catch (_) {
      failed++;
    }
  }
  logger.info('subscription billing completed', { scanned: due.length, created, skipped, failed });
  if (failed) throw new Error(`${failed} subscription billing record(s) failed`);
  return { scanned: due.length, created, skipped, failed };
}

module.exports = { billOneSubscription, nextBillingDate, runSubscriptionBilling };
