'use strict';

// What the mail relay tells us about the messages it took (31 Oct 2026 audit). In Brevo: Transactional → Settings → Webhooks →
// URL https://<api host>/api/webhooks/brevo?token=<BREVO_WEBHOOK_TOKEN>, events: delivered, soft/hard bounce, blocked, spam,
// invalid, unsubscribed (and «Marketing → Webhooks» for the campaign mails). See lib/emailDelivery.js for what is done with it.

const crypto = require('node:crypto');
const express = require('express');
const { resolveSecret } = require('../lib/secretResolver');
const { parseEvents, recordEvents, summary } = require('../lib/emailDelivery');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { whatsappWebhookLimiter } = require('../middleware/rateLimits');
const logger = require('../lib/logger');

const router = express.Router();

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Brevo cannot sign a call; it carries whatever the URL holds, or HTTP basic credentials written into it. The token is
// accepted in the query string, in X-Webhook-Token, or as the password of a basic-auth header.
function presentedToken(req) {
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  const fromBasic = basic ? Buffer.from(basic[1], 'base64').toString('utf8').split(':').slice(1).join(':') : '';
  return String(req.query.token || req.headers['x-webhook-token'] || fromBasic || '');
}

router.post('/api/webhooks/brevo', whatsappWebhookLimiter, async (req, res) => {
  let token = '';
  try { token = resolveSecret('BREVO_WEBHOOK_TOKEN'); } catch (_) { /* not configured */ }
  if (!token) return res.status(503).json({ error: 'Email webhook token is not configured' });
  if (!safeEqual(presentedToken(req), token)) return res.status(401).json({ error: 'Invalid webhook token' });
  try {
    const result = await recordEvents(req.tenantId, parseEvents(req.body));
    res.json({ ok: true, ...result });
  } catch (error) {
    // 500 makes the relay retry, which is right: the events are not lost, only late.
    logger.error('[email-webhook]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// What happened to the mail of the last N days: the counts, the share that did not arrive, the latest bounces.
router.get('/api/admin/email/deliveries', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await summary(req.tenantId, req.query.days));
  } catch (error) {
    logger.error('[email-deliveries]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
