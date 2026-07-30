'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../lib/logger').child({ module: 'payment-intents-route' });
const { pool } = require('../lib/db');
const { ensureSubscriberForOrder } = require('../lib/subscriberProvisioning');
const { getOrCreatePaymentIntent } = require('../lib/paymentIntents');
const { requireAuth } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');

const tenantIdFor = req => req.tenantId || req.user?.tenant_id || 'tenant-default';
const branchForId = branchId => ({
  'branch-daqqi': 'DAQQI',
  'branch-tagamoa': 'TAGAMOA',
  'branch-online-saudi': 'ONLINE_SAUDI',
  'branch-online-abroad': 'ONLINE_ABROAD',
  'branch-online-egypt': 'ONLINE_EGYPT',
}[branchId] || 'ONLINE_EGYPT');

router.post('/api/me/payment-intents', requireAuth, publicLimiter, async (req, res) => {
  const conn = await pool.getConnection();
  let started = false;
  try {
    const tenantId = tenantIdFor(req);
    const email = String(req.user?.email || '').toLowerCase().trim();
    const orderId = String(req.body?.order_id || '').trim();
    const provider = String(req.body?.provider || 'manual').toLowerCase();
    if (!email || !orderId) return res.status(400).json({ error: 'order_id and authenticated email required' });
    if (provider !== 'manual') {
      return res.status(503).json({ error: 'Online payment is disabled pending provider approval', code: 'PAYMOB_DISABLED' });
    }
    await conn.beginTransaction();
    started = true;
    const [[order]] = await conn.query(
      `SELECT id,amount,currency,status,customer_name,customer_phone,customer_email,
              subscriber_id,tenant_id,branch_id
         FROM orders
        WHERE id=? AND tenant_id=? AND LOWER(TRIM(customer_email))=?
        LIMIT 1 FOR UPDATE`,
      [orderId, tenantId, email]
    );
    if (!order) return await rollback(conn, res, 404, 'Order not found');
    if (String(order.status).toLowerCase() !== 'pending') {
      return await rollback(conn, res, 409, 'Order is not pending payment');
    }
    const subscriber = await ensureSubscriberForOrder(conn, {
      tenantId, uid: req.user.uid, email, name: order.customer_name, phone: order.customer_phone,
      fallbackBranch: branchForId(order.branch_id), fallbackBranchId: order.branch_id,
    });
    await conn.query('UPDATE orders SET subscriber_id=? WHERE id=? AND tenant_id=?', [subscriber.id, order.id, tenantId]);
    const intent = await getOrCreatePaymentIntent(conn, {
      tenantId, order, subscriberId: subscriber.id, actor: req.user.uid || email, provider,
      idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotency_key,
    });
    await conn.commit();
    started = false;
    res.status(201).json({
      ok: true, id: intent.id, order_id: order.id, provider: intent.provider,
      amount: Number(intent.amount), currency: intent.currency, status: intent.status,
    });
  } catch (error) {
    if (started) await conn.rollback().catch(() => {});
    logger.error(error.message);
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'Could not create payment intent',
      ...(error.code ? { code: error.code } : {}),
    });
  } finally {
    conn.release();
  }
});

router.get('/api/me/payment-intents', requireAuth, async (req, res) => {
  try {
    const tenantId = tenantIdFor(req);
    const email = String(req.user?.email || '').toLowerCase().trim();
    const [rows] = await pool.query(
      `SELECT pi.id,pi.order_id,pi.provider,pi.amount,pi.currency,pi.status,pi.failure_code,
              pi.expires_at,pi.created_at,COUNT(pa.id) AS attempt_count
         FROM payment_intents pi
         JOIN subscribers s ON s.id=pi.subscriber_id AND s.tenant_id=pi.tenant_id
         LEFT JOIN payment_attempts pa ON pa.intent_id=pi.id AND pa.tenant_id=pi.tenant_id
        WHERE pi.tenant_id=? AND LOWER(TRIM(s.email))=?
        GROUP BY pi.id
        ORDER BY pi.created_at DESC LIMIT 100`,
      [tenantId, email]
    );
    res.json(rows.map(row => ({ ...row, amount: Number(row.amount), attempt_count: Number(row.attempt_count) })));
  } catch (error) {
    logger.error(error.message);
    res.status(500).json({ error: 'Could not load payment intents' });
  }
});

async function rollback(conn, res, status, message) {
  await conn.rollback();
  return res.status(status).json({ error: message });
}

module.exports = router;
