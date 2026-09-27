'use strict';

// «أي دفعة: إيميل للعميل بالمبلغ اللي اتدفع وإن جزء جديد من الكورس اتفتح».
//
// One receipt per paid payment, from whichever path made it paid — recorded
// paid, approved later, a transfer receipt accepted, an order confirmed,
// Paymob, an instalment. Each path used to write its own, or none: a payment
// recorded as pending and approved later reached the client with nothing, and
// one recorded paid outright got two (its own email and the lifecycle's).
//
// It goes through the lifecycle's «استلام دفعة» step, so it can be switched off
// from رحلة العميل, and through the outbox keyed by the payment, so a second
// path finishing the same payment is a no-op and a failed send is retried.

const { pool } = require('./db');
const lifecycle = require('./lifecycle');
const logger = require('./logger');
const { itemBalances, itemKey } = require('./agreedPrice');

// What the client can open now, course by course, after this payment.
async function unlockedFor(db, tenantId, payment) {
  const courseIds = [];
  if (payment.course_id) courseIds.push(payment.course_id);
  if (payment.bundle_id) {
    const [rows] = await db.query(
      'SELECT course_id FROM bundle_courses WHERE tenant_id=? AND bundle_id=?', [tenantId, payment.bundle_id]);
    courseIds.push(...rows.map(row => row.course_id));
  }
  const ids = [...new Set(courseIds)];
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT c.id, c.title, e.access_type, e.lecture_limit, e.status,
            (SELECT COUNT(*) FROM course_lectures l WHERE l.course_id=c.id AND l.is_published=1) AS total
       FROM courses c
       LEFT JOIN enrollments e ON e.course_id=c.id AND e.tenant_id=c.tenant_id AND e.subscriber_id=?
      WHERE c.tenant_id=? AND c.id IN (${marks})`,
    [payment.subscriber_id, tenantId, ...ids]
  );
  return rows
    .filter(row => row.status === 'active')
    .map(row => {
      const total = Number(row.total) || 0;
      const full = row.access_type !== 'limited';
      return { title: row.title, full, total, open: full ? total : Math.min(total, Number(row.lecture_limit) || 0) };
    });
}

// What is still owed on this item, by the same balance every screen shows
// (lib/agreedPrice.js): the price agreed, less what was paid here and before.
async function remainingFor(db, tenantId, payment) {
  const balances = await itemBalances(db, { tenantId, subscriberId: payment.subscriber_id });
  const entry = balances.get(itemKey({ courseId: payment.bundle_id ? null : payment.course_id, bundleId: payment.bundle_id }));
  return entry && entry.expected > 0 ? entry.remaining : null;
}

/** Queue the receipt for one payment, once. Never throws into the caller. */
async function queuePaymentReceipt(tenantId, paymentId, db = pool) {
  try {
    const [[payment]] = await db.query(
      `SELECT p.id, p.subscriber_id, p.course_id, p.bundle_id, p.amount, p.currency, p.status,
              p.payment_method, p.item_title, DATE_FORMAT(p.date, '%Y-%m-%d') AS day,
              s.name, s.email, COALESCE(c.title, b.title) AS title
         FROM payments p
         JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
         LEFT JOIN courses c ON c.id=p.course_id AND c.tenant_id=p.tenant_id
         LEFT JOIN bundles b ON b.id=p.bundle_id AND b.tenant_id=p.tenant_id
        WHERE p.id=? AND p.tenant_id=? AND p.deleted_at IS NULL LIMIT 1`,
      [paymentId, tenantId]
    );
    if (!payment || payment.status !== 'paid' || !payment.email) return false;
    await lifecycle.trigger('payment_received', {
      tenantId,
      name: payment.name,
      email: payment.email,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.payment_method && payment.payment_method !== 'installment' ? payment.payment_method : null,
      itemTitle: payment.title || payment.item_title || null,
      date: payment.day,
      unlocked: await unlockedFor(db, tenantId, payment),
      remaining: await remainingFor(db, tenantId, payment),
    }, { channels: ['email'], dedupeKey: `payment:${payment.id}` });
    return true;
  } catch (error) {
    logger.warn('[payment-receipt] not queued', { paymentId, error: error.message });
    return false;
  }
}

module.exports = { queuePaymentReceipt };
