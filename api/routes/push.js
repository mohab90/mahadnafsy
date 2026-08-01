'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const logger = require('../lib/logger').child({ module: 'push-route' });
const { isPushConfigured, publicVapidKey, sendPushNotification } = require('../lib/push');
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { requireAuth } = require('../middleware/auth');
const { resolveSubscriberId } = require('../lib/subscriberIdentity');
const { publicLimiter } = require('../middleware/rateLimits');

function endpointHash(subscription) {
  return crypto.createHash('sha256').update(String(subscription?.endpoint || '')).digest('hex');
}

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

// scopedTenantId falls back for requests that arrive before tenant resolution;
// the shared resolver reads req.tenantId, so hand it a request that always has one.
function subscriberIdForUser(req) {
  return resolveSubscriberId(req.tenantId ? req : { ...req, tenantId: scopedTenantId(req) });
}

// GET /api/push/vapid-public-key
router.get('/api/push/vapid-public-key', publicLimiter, (_req, res) => {
  res.json({
    ok: true,
    enabled: isPushConfigured(),
    publicKey: isPushConfigured() ? publicVapidKey : null,
  });
});

// POST /api/push/subscribe
router.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const subscription = req.body?.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'valid push subscription required' });
    }

    const subscriberId = await subscriberIdForUser(req);
    const hash = endpointHash(subscription);
    await pool.query(
      `INSERT INTO push_subscriptions
         (id, tenant_id, user_uid, subscriber_id, endpoint_hash, subscription_json, user_agent, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         tenant_id = VALUES(tenant_id),
         user_uid = VALUES(user_uid),
         subscriber_id = VALUES(subscriber_id),
         subscription_json = VALUES(subscription_json),
         user_agent = VALUES(user_agent),
         is_active = 1,
         last_error = NULL`,
      [
        uuidv4(),
        scopedTenantId(req),
        req.user?.uid || null,
        subscriberId,
        hash,
        JSON.stringify(subscription),
        String(req.headers['user-agent'] || '').slice(0, 500),
      ]
    );

    res.status(201).json({ ok: true, enabled: isPushConfigured(), subscriberId });
  } catch (error) {
    logger.error('push subscribe failed', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// DELETE /api/push/subscribe
router.delete('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const subscription = req.body?.subscription;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription endpoint required' });
    await pool.query(
      'UPDATE push_subscriptions SET is_active = 0 WHERE tenant_id = ? AND endpoint_hash = ?',
      [scopedTenantId(req), endpointHash(subscription)]
    );
    res.json({ ok: true });
  } catch (error) {
    logger.error('push unsubscribe failed', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// POST /api/push/test-send
router.post('/api/push/test-send', requireAuth, async (req, res) => {
  try {
    const subscriberId = await subscriberIdForUser(req);
    const [rows] = await pool.query(
      `SELECT id, subscription_json
       FROM push_subscriptions
       WHERE tenant_id = ? AND is_active = 1 AND (user_uid = ? OR subscriber_id = ?)
       ORDER BY updated_at DESC
       LIMIT 5`,
      [scopedTenantId(req), req.user?.uid || null, subscriberId]
    );
    if (!rows.length) return res.status(400).json({ error: 'No active push subscriptions' });

    const payload = {
      title: 'معهد الدراسات النفسية',
      body: req.body?.body || 'تم تفعيل إشعارات المتصفح بنجاح.',
      url: req.body?.url || '/dashboard',
    };

    const results = await Promise.allSettled(rows.map(async row => {
      const subscription = typeof row.subscription_json === 'string'
        ? JSON.parse(row.subscription_json)
        : row.subscription_json;
      await sendPushNotification(subscription, payload);
      await pool.query(
        'UPDATE push_subscriptions SET last_sent_at = NOW(), last_error = NULL WHERE id = ? AND tenant_id = ?',
        [row.id, scopedTenantId(req)]
      );
    }));

    const sent = results.filter(r => r.status === 'fulfilled').length;
    if (sent === 0) {
      const reason = results.find(r => r.status === 'rejected')?.reason;
      return res.status(reason?.statusCode || 500).json({ error: reason?.message || 'Failed to send push notification' });
    }
    res.json({ ok: true, sent, attempted: rows.length });
  } catch (error) {
    logger.error('push test-send failed', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to send test notification' });
  }
});

module.exports = router;
