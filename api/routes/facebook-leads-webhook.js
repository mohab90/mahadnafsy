'use strict';

const crypto = require('node:crypto');
const express = require('express');
const logger = require('../lib/logger').child({ module: 'facebook-leads-webhook-route' });
const { DEFAULT_TENANT_ID, platformFallback, resolveTenantId } = require('../lib/tenantScope');
const { getFbLeadConfig } = require('../lib/facebookLeadAds');
const { enqueueConnectorEvent, drainConnectorEvents } = require('../lib/connectorEvents');
const { processFacebookLeadEvent } = require('../lib/facebookLeadEvents');
const { publicLimiter } = require('../middleware/rateLimits');

const router = express.Router();
const tenantIdFor = req => req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

router.get('/api/webhooks/facebook-leads', publicLimiter, async (req, res) => {
  const tenantId = tenantIdFor(req);
  const config = await getFbLeadConfig(tenantId).catch(() => ({}));
  const verifyToken = config.verifyToken || platformFallback(tenantId, process.env.FB_VERIFY_TOKEN);
  const verified = req.query['hub.mode'] === 'subscribe'
    && verifyToken
    && safeEqual(req.query['hub.verify_token'], verifyToken);
  if (!verified) return res.status(403).json({ error: 'Verification failed' });
  return res.status(200).send(String(req.query['hub.challenge'] || ''));
});

router.post('/api/webhooks/facebook-leads', publicLimiter, async (req, res) => {
  const tenantId = tenantIdFor(req);
  const config = await getFbLeadConfig(tenantId).catch(() => ({}));
  const appSecret = config.appSecret || platformFallback(tenantId, process.env.FB_APP_SECRET);
  if (!appSecret) return res.status(503).json({ error: 'Facebook webhook secret is not configured' });
  const signature = String(req.headers['x-hub-signature-256'] || '');
  const expected = `sha256=${crypto.createHmac('sha256', appSecret)
    .update(req.rawBody || Buffer.alloc(0)).digest('hex')}`;
  if (!safeEqual(signature, expected)) return res.status(403).json({ error: 'Invalid webhook signature' });
  if (req.body?.object !== 'page') return res.status(202).json({ received: true, ignored: true });

  try {
    const accepted = await enqueueLeadPayload(req.body, req.rawBody, tenantId);
    // A Meta app has one callback address for its Page events: a page's
    // Messenger messages come here too when this is the address that was set.
    const inbound = await require('./messenger-webhook').recordMessengerPayload(req.body, tenantId);
    res.status(accepted.duplicate ? 200 : 202).json({
      received: true,
      duplicate: accepted.duplicate,
      event_id: accepted.id,
      status: accepted.status,
      inbound,
    });
  } catch (error) {
    logger.error('Facebook webhook persistence failed', error);
    return res.status(503).json({ error: 'Webhook event could not be persisted' });
  }
});

/** A verified Page event, queued for the Lead Ads worker and drained. */
async function enqueueLeadPayload(body, rawBody, tenantId) {
  const raw = rawBody?.length ? rawBody : Buffer.from(JSON.stringify(body || {}));
  const externalEventId = crypto.createHash('sha256').update(tenantId).update(raw).digest('hex');
  const accepted = await enqueueConnectorEvent({
    tenantId,
    provider: 'facebook_leads',
    externalEventId,
    payload: body,
  });
  setImmediate(() => {
    drainConnectorEvents({ facebook_leads: processFacebookLeadEvent }, { limit: 10 })
      .catch(error => logger.warn('Facebook connector drain failed', error.message));
  });
  return accepted;
}

module.exports = router;
module.exports.enqueueLeadPayload = enqueueLeadPayload;
