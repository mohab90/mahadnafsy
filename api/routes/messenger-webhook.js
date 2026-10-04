'use strict';
/**
 * Facebook Messenger webhook.
 *
 * Same signature scheme as the WhatsApp/Meta webhook — the payload is signed
 * with the app secret and verified before anything is read from it, because an
 * unsigned webhook is an open endpoint for writing into the CRM.
 */
const crypto = require('node:crypto');
const express = require('express');
const { resolveSecret } = require('../lib/secretResolver');
const { extractMessengerMessages, recordInboundMessenger } = require('../lib/messenger');
const { getSendableChannel, channelByExternalId } = require('../lib/messagingChannels');
const { whatsappWebhookLimiter } = require('../middleware/rateLimits');
const logger = require('../lib/logger');

const router = express.Router();

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get('/api/webhooks/messenger', whatsappWebhookLimiter, (req, res) => {
  let token = '';
  try { token = resolveSecret('MESSENGER_WEBHOOK_VERIFY_TOKEN'); } catch (_) {}
  const verified = req.query['hub.mode'] === 'subscribe'
    && token
    && safeEqual(req.query['hub.verify_token'], token);
  if (!verified) return res.sendStatus(403);
  return res.status(200).send(String(req.query['hub.challenge'] || ''));
});

router.post('/api/webhooks/messenger', whatsappWebhookLimiter, async (req, res) => {
  let appSecret = '';
  try { appSecret = resolveSecret('MESSENGER_APP_SECRET'); } catch (_) {}
  // Falls back to the WhatsApp app secret: both usually live under one Meta app,
  // and requiring a second identical value is a configuration step that gets
  // skipped and then debugged as "the webhook doesn't work".
  if (!appSecret) { try { appSecret = resolveSecret('WHATSAPP_APP_SECRET'); } catch (_) {} }
  if (!appSecret) return res.status(503).json({ error: 'Messenger webhook secret is not configured' });

  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(req.rawBody || Buffer.alloc(0)).digest('hex')}`;
  if (!safeEqual(req.headers['x-hub-signature-256'], expected)) {
    return res.status(401).json({ error: 'Invalid Messenger webhook signature' });
  }

  try {
    const messages = extractMessengerMessages(req.body);
    if (!messages.length) return res.json({ received: true, inbound: 0 });

    // The page a message came to says whose it is (Instagram names the
    // account instead, so it falls back to the tenant's page). The reply
    // window is kept on the lead by recordInboundMessenger.
    const fallback = await getSendableChannel({ tenantId: req.tenantId, kind: 'messenger' }).catch(() => null);
    const results = [];
    for (const message of messages) {
      const routed = await channelByExternalId(message.pageId).catch(() => null);
      results.push(await recordInboundMessenger({
        tenantId: routed?.tenant_id || req.tenantId,
        channelId: routed?.id || fallback?.row?.id || null,
        ...message,
      }));
    }
    return res.json({ received: true, inbound: results.filter(r => r.recorded).length });
  } catch (error) {
    logger.error('[Messenger webhook] processing failed', error.message);
    return res.status(500).json({ error: 'Messenger inbound processing failed' });
  }
});

module.exports = router;
