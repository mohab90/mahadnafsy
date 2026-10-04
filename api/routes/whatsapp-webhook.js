'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { resolveSecret } = require('../lib/secretResolver');
const { applyDeliveryStatus } = require('../lib/whatsappDelivery');
const {
  recordInboundMessage, extractMetaMessages, extractGreenApiMessage,
} = require('../lib/whatsappInbound');
const { channelByExternalId } = require('../lib/messagingChannels');
const { whatsappWebhookLimiter } = require('../middleware/rateLimits');
const logger = require('../lib/logger');

const router = express.Router();

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get('/api/webhooks/whatsapp/meta', whatsappWebhookLimiter, (req, res) => {
  let token = '';
  try { token = resolveSecret('WHATSAPP_WEBHOOK_VERIFY_TOKEN'); } catch (_) {}
  const verified = req.query['hub.mode'] === 'subscribe'
    && token
    && safeEqual(req.query['hub.verify_token'], token);
  if (!verified) return res.sendStatus(403);
  return res.status(200).send(String(req.query['hub.challenge'] || ''));
});

router.post('/api/webhooks/whatsapp/meta', whatsappWebhookLimiter, async (req, res) => {
  let appSecret = '';
  try { appSecret = resolveSecret('WHATSAPP_APP_SECRET'); } catch (_) {}
  if (!appSecret) return res.status(503).json({ error: 'WhatsApp webhook secret is not configured' });
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(req.rawBody || Buffer.alloc(0)).digest('hex')}`;
  if (!safeEqual(req.headers['x-hub-signature-256'], expected)) {
    return res.status(401).json({ error: 'Invalid WhatsApp webhook signature' });
  }

  try {
    // The number a change was sent to says whose it is: one Meta app can carry
    // the numbers of more than one tenant, and the host the webhook reached
    // says nothing about that.
    const routes = new Map();
    const route = async phoneNumberId => {
      if (!routes.has(phoneNumberId)) {
        const channel = await channelByExternalId(phoneNumberId).catch(() => null);
        routes.set(phoneNumberId, { tenantId: channel?.tenant_id || req.tenantId, channelId: channel?.id || null });
      }
      return routes.get(phoneNumberId);
    };
    const statuses = (req.body?.entry || []).flatMap(entry =>
      (entry.changes || []).flatMap(change => (change.value?.statuses || [])
        .map(status => ({ ...status, phoneNumberId: change.value?.metadata?.phone_number_id || null }))));
    const updated = [];
    for (const status of statuses) {
      const { tenantId } = await route(status.phoneNumberId);
      updated.push(await applyDeliveryStatus({
        provider: 'meta',
        tenantId,
        messageId: status.id,
        status: status.status,
        timestamp: status.timestamp,
        error: status.errors?.length ? JSON.stringify(status.errors) : null,
      }));
    }
    // Inbound replies ride in the same payload as statuses and used to be
    // dropped: the customer answered and nobody in the institute ever knew.
    const inbound = [];
    for (const { phoneNumberId, ...message } of extractMetaMessages(req.body)) {
      const { tenantId, channelId } = await route(phoneNumberId);
      inbound.push(await recordInboundMessage({ tenantId, channelId, ...message }));
    }
    return res.json({
      received: true,
      updated: updated.filter(Boolean).length,
      inbound: inbound.filter(result => result.recorded).length,
    });
  } catch (error) {
    logger.error('[WhatsApp webhook] Meta status processing failed', error.message);
    return res.status(500).json({ error: 'WhatsApp delivery status processing failed' });
  }
});

router.post('/api/webhooks/whatsapp/green-api', whatsappWebhookLimiter, async (req, res) => {
  let webhookSecret = '';
  try { webhookSecret = resolveSecret('WHATSAPP_GREEN_WEBHOOK_SECRET'); } catch (_) {}
  const supplied = req.headers['x-webhook-token'] || req.query.token;
  if (!webhookSecret) return res.status(503).json({ error: 'WhatsApp webhook secret is not configured' });
  if (!safeEqual(supplied, webhookSecret)) {
    return res.status(401).json({ error: 'Invalid WhatsApp webhook token' });
  }
  const configuredInstance = String(process.env.WA_INSTANCE_ID || '').trim();
  const receivedInstance = String(req.body?.instanceData?.idInstance || '').trim();
  if (configuredInstance && receivedInstance && configuredInstance !== receivedInstance) {
    return res.status(401).json({ error: 'WhatsApp instance mismatch' });
  }
  // An incoming reply is not a status callback, and used to fall through here
  // and be discarded — the rep never learned the customer had answered.
  if (req.body?.typeWebhook === 'incomingMessageReceived') {
    try {
      const message = extractGreenApiMessage(req.body);
      const result = message
        ? await recordInboundMessage({ tenantId: req.tenantId, ...message })
        : { recorded: false };
      return res.json({ received: true, inbound: result.recorded ? 1 : 0 });
    } catch (error) {
      logger.error('[WhatsApp webhook] Green API inbound processing failed', error.message);
      return res.status(500).json({ error: 'WhatsApp inbound processing failed' });
    }
  }
  if (req.body?.typeWebhook !== 'outgoingMessageStatus') {
    return res.json({ received: true, updated: 0 });
  }

  try {
    const updated = await applyDeliveryStatus({
      provider: 'green-api',
      messageId: req.body.idMessage,
      status: req.body.status,
      timestamp: req.body.timestamp,
      error: req.body.description || null,
    });
    return res.json({ received: true, updated: updated ? 1 : 0 });
  } catch (error) {
    logger.error('[WhatsApp webhook] Green API status processing failed', error.message);
    return res.status(500).json({ error: 'WhatsApp delivery status processing failed' });
  }
});

module.exports = router;
