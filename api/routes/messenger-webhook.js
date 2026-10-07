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
const { getFbLeadConfig } = require('../lib/facebookLeadAds');
const { DEFAULT_TENANT_ID, platformFallback } = require('../lib/tenantScope');

// One Meta app has one callback address for its Page events, so a page's
// messages and its Lead Ads arrive at whichever of the two addresses was set,
// signed with that app's secret and verified with its token. These were
// MESSENGER_* settings only, which the server never had, while the Facebook
// app's own (FB_VERIFY_TOKEN, FB_APP_SECRET, or «مصادر الليد») were there: the
// Messenger channel connected on 7 Oct 2026 could not receive a thing.
const secretOf = name => { try { return resolveSecret(name); } catch (_) { return ''; } };
async function metaAppSettings(tenantId) {
  const fb = await getFbLeadConfig(tenantId || DEFAULT_TENANT_ID).catch(() => ({}));
  return {
    verifyToken: secretOf('MESSENGER_WEBHOOK_VERIFY_TOKEN') || fb.verifyToken
      || platformFallback(tenantId || DEFAULT_TENANT_ID, process.env.FB_VERIFY_TOKEN) || '',
    appSecret: secretOf('MESSENGER_APP_SECRET') || secretOf('WHATSAPP_APP_SECRET') || fb.appSecret
      || platformFallback(tenantId || DEFAULT_TENANT_ID, process.env.FB_APP_SECRET) || '',
  };
}

/** The messages a verified Page event carries, recorded on their channel. */
async function recordMessengerPayload(body, tenantId) {
  const messages = extractMessengerMessages(body);
  if (!messages.length) return 0;
  // The page a message came to says whose it is (Instagram names the account
  // instead, so it falls back to the tenant's page). The reply window is kept
  // on the lead by recordInboundMessenger.
  const fallback = await getSendableChannel({ tenantId, kind: 'messenger' }).catch(() => null);
  let recorded = 0;
  for (const message of messages) {
    const routed = await channelByExternalId(message.pageId).catch(() => null);
    const result = await recordInboundMessenger({
      tenantId: routed?.tenant_id || tenantId,
      channelId: routed?.id || fallback?.row?.id || null,
      ...message,
    });
    if (result?.recorded) recorded += 1;
  }
  return recorded;
}

const router = express.Router();

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get('/api/webhooks/messenger', whatsappWebhookLimiter, async (req, res) => {
  const token = (await metaAppSettings(req.tenantId)).verifyToken;
  const verified = req.query['hub.mode'] === 'subscribe'
    && token
    && safeEqual(req.query['hub.verify_token'], token);
  if (!verified) return res.sendStatus(403);
  return res.status(200).send(String(req.query['hub.challenge'] || ''));
});

router.post('/api/webhooks/messenger', whatsappWebhookLimiter, async (req, res) => {
  const { appSecret } = await metaAppSettings(req.tenantId);
  if (!appSecret) return res.status(503).json({ error: 'Messenger webhook secret is not configured' });

  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(req.rawBody || Buffer.alloc(0)).digest('hex')}`;
  if (!safeEqual(req.headers['x-hub-signature-256'], expected)) {
    return res.status(401).json({ error: 'Invalid Messenger webhook signature' });
  }

  try {
    // Lead Ads on the same Page event go where the Lead Ads route sends them.
    if (hasLeadgen(req.body)) await require('./facebook-leads-webhook').enqueueLeadPayload(req.body, req.rawBody, req.tenantId || DEFAULT_TENANT_ID);
    const inbound = await recordMessengerPayload(req.body, req.tenantId);
    return res.json({ received: true, inbound });
  } catch (error) {
    logger.error('[Messenger webhook] processing failed', error.message);
    return res.status(500).json({ error: 'Messenger inbound processing failed' });
  }
});

const hasLeadgen = body => (body?.entry || []).some(entry => (entry?.changes || []).some(change => change?.field === 'leadgen'));

module.exports = router;
module.exports.recordMessengerPayload = recordMessengerPayload;
