'use strict';

// 7 Oct 2026: the owner connected the institute's page to Messenger («متصل»)
// and not one message ever reached the system — no call to the webhook at all.
//   - Connecting checked the page token and never subscribed the page to the
//     app, and a page sends nothing to an app it is not subscribed to.
//   - The webhook knew only MESSENGER_* settings, which the server never had;
//     the Facebook app's own verify token and secret were there.
//   - A Meta app has one callback address for Page events, so a page's
//     messages and its Lead Ads arrive at whichever address was set, and each
//     route dropped the other's half.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.FB_VERIFY_TOKEN = 'fb-verify-test';
process.env.FB_APP_SECRET = 'fb-secret-test';
delete process.env.MESSENGER_WEBHOOK_VERIFY_TOKEN;
delete process.env.MESSENGER_APP_SECRET;
delete process.env.WHATSAPP_APP_SECRET;

const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', { pool: { query: async () => [[]] }, cached: async (_k, _t, fn) => fn(), cacheInvalidate() {}, requireDb: (_q, _s, n) => n(), isDbDown: () => false });
stub('../lib/facebookLeadAds', { getFbLeadConfig: async () => ({}) });
const queued = [];
stub('../lib/connectorEvents', {
  enqueueConnectorEvent: async event => { queued.push(event); return { id: 'e-1', duplicate: false, status: 'pending' }; },
  drainConnectorEvents: async () => {},
});
stub('../lib/facebookLeadEvents', { processFacebookLeadEvent: async () => {} });
stub('../lib/messagingChannels', {
  getSendableChannel: async () => ({ row: { id: 'ch-messenger' } }),
  channelByExternalId: async () => ({ id: 'ch-messenger', tenant_id: 'tenant-default' }),
});
const realMessenger = require('../lib/messenger');
const recorded = [];
stub('../lib/messenger', { ...realMessenger, recordInboundMessenger: async message => { recorded.push(message); return { recorded: true }; } });

const messengerRoute = require('../routes/messenger-webhook');
const leadsRoute = require('../routes/facebook-leads-webhook');
const handlerOf = (router, method, route) => {
  const layer = router.stack.find(item => item.route && item.route.path === route && item.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}
function signed(body) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = `sha256=${crypto.createHmac('sha256', 'fb-secret-test').update(rawBody).digest('hex')}`;
  return { body, rawBody, headers: { 'x-hub-signature-256': signature }, tenantId: 'tenant-default', query: {} };
}
const message = {
  object: 'page',
  entry: [{ id: 'page-1', time: 1, messaging: [{ sender: { id: 'psid-9' }, recipient: { id: 'page-1' }, timestamp: 1, message: { mid: 'm-1', text: 'عايزة أعرف سعر الدبلومة' } }] }],
};

test('Meta can verify the Messenger address with the Facebook app\'s token', async () => {
  const res = response();
  await handlerOf(messengerRoute, 'get', '/api/webhooks/messenger')(
    { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'fb-verify-test', 'hub.challenge': 'ch-42' }, tenantId: 'tenant-default' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ch-42');
});

test('a message signed by the Facebook app reaches the inbox', async () => {
  recorded.length = 0;
  const res = response();
  await handlerOf(messengerRoute, 'post', '/api/webhooks/messenger')(signed(message), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.inbound, 1);
  assert.equal(recorded[0].channelId, 'ch-messenger');
});

test('a message that arrives at the Lead Ads address is recorded too', async () => {
  recorded.length = 0; queued.length = 0;
  const res = response();
  await handlerOf(leadsRoute, 'post', '/api/webhooks/facebook-leads')(signed(message), res);
  assert.equal(res.body.inbound, 1);
  assert.equal(recorded.length, 1);
});

test('a lead that arrives at the Messenger address is queued for Lead Ads', async () => {
  queued.length = 0;
  const lead = { object: 'page', entry: [{ id: 'page-1', changes: [{ field: 'leadgen', value: { leadgen_id: 'lg-1', page_id: 'page-1' } }] }] };
  const res = response();
  await handlerOf(messengerRoute, 'post', '/api/webhooks/messenger')(signed(lead), res);
  assert.equal(res.statusCode, 200);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].provider, 'facebook_leads');
});

test('checking the channel subscribes the page, and settles for messages when leadgen is refused', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url: String(url), body: String(options.body || '') });
    if (String(url).includes('/me?')) return new Response(JSON.stringify({ id: 'page-1', name: 'معهد الدراسات النفسية' }));
    if (String(options.body).includes('leadgen')) return new Response(JSON.stringify({ error: { message: 'needs leads_retrieval' } }), { status: 400 });
    return new Response(JSON.stringify({ success: true }));
  });
  const check = await realMessenger.verifyMessengerCredentials({ pageAccessToken: 'page-token' });
  assert.equal(check.ok, true);
  assert.equal(check.subscribed, true);
  assert.equal(check.subscribedFields, 'messages,messaging_postbacks');
  assert.ok(calls.some(call => call.url.endsWith('/page-1/subscribed_apps')), 'the page is subscribed to the app');
});
