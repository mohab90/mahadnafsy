'use strict';
// Wapilot's send endpoint is undocumented, so it is configuration rather than a
// hardcoded path. That makes the mapping from stored credentials to an actual
// HTTP call the part most worth pinning: get it wrong and a WORKING session
// silently sends nothing.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  BASE, DEFAULT_SEND_PATH, DEFAULT_RECIPIENT_FIELD, DEFAULT_MESSAGE_FIELD,
  verifyWapilot, listWapilotInstances, sendViaWapilot,
} = require('../lib/whatsappWapilot');

/** Captures the request instead of making it. */
function stubFetch(response, captured = {}) {
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    captured.url = String(url);
    captured.options = options;
    captured.body = options.body ? JSON.parse(options.body) : null;
    return {
      ok: response.ok !== false,
      status: response.status || 200,
      json: async () => response.json,
    };
  };
  return () => { global.fetch = original; };
}

test('auth is Bearer — the only scheme the live API accepts', async () => {
  const captured = {};
  const restore = stubFetch({ json: { success: true, status: 'WORKING', me_id: '201200400031@c.us' } }, captured);
  try {
    await verifyWapilot({ apiKey: 'KEY', instance: 'instance5000' });
    assert.equal(captured.options.headers.Authorization, 'Bearer KEY');
  } finally { restore(); }
});

test('verification reads the session status, not just a 200', async () => {
  // A logged-out session still answers 200; only WORKING can actually send, and
  // calling anything else "connected" hides a dead session until a customer
  // notices.
  for (const status of ['STOPPED', 'STARTING', 'FAILED', 'SCAN_QR_CODE']) {
    const restore = stubFetch({ json: { success: true, status, status_message: 'nope' } });
    try {
      const result = await verifyWapilot({ apiKey: 'K', instance: 'i' });
      assert.equal(result.ok, false, `${status} must not verify`);
      assert.equal(result.status, status);
    } finally { restore(); }
  }
});

test('a WORKING session verifies and reports the number behind it', async () => {
  const restore = stubFetch({ json: {
    success: true, status: 'WORKING',
    me_id: '201200400031@c.us', me_push_name: 'معهد الدراسات النفسية',
  } });
  try {
    const result = await verifyWapilot({ apiKey: 'K', instance: 'i' });
    assert.equal(result.ok, true);
    // The @c.us suffix must be stripped — it is a chat id, not a phone number.
    assert.equal(result.number, '201200400031');
    assert.equal(result.name, 'معهد الدراسات النفسية');
  } finally { restore(); }
});

test('missing credentials never reach the network', async () => {
  const restore = stubFetch({ json: {} });
  try {
    assert.equal((await verifyWapilot({})).reason, 'not_configured');
    assert.equal((await verifyWapilot({ apiKey: 'K' })).reason, 'not_configured');
    assert.equal((await verifyWapilot({ instance: 'i' })).reason, 'not_configured');
    assert.equal((await sendViaWapilot('201012345678', 'hi', {})).reason, 'not_configured');
  } finally { restore(); }
});

test('a recipient is addressed as a chat id, the way the API reports its own', async () => {
  const captured = {};
  const restore = stubFetch({ json: { success: true, message_id: 'm1' } }, captured);
  try {
    await sendViaWapilot('201012345678', 'مرحباً', { apiKey: 'K', instance: 'instance5000' });
    assert.equal(captured.body[DEFAULT_RECIPIENT_FIELD], '201012345678@c.us');
    assert.equal(captured.body[DEFAULT_MESSAGE_FIELD], 'مرحباً');
  } finally { restore(); }
});

test('a local number is completed rather than addressed as-is', async () => {
  // The adapter re-normalises instead of trusting its caller. 01012345678@c.us
  // is nobody, and a missing country code is the most expensive bug this system
  // has had — the adapter is the last place it can still be caught.
  const captured = {};
  const restore = stubFetch({ json: { success: true } }, captured);
  try {
    await sendViaWapilot('01012345678', 'hi', { apiKey: 'K', instance: 'i' });
    assert.equal(captured.body.chat_id, '201012345678@c.us');
  } finally { restore(); }
});

test('an undialable number is refused instead of sent to a wrong address', async () => {
  const restore = stubFetch({ json: { success: true } });
  try {
    for (const junk of ['', 'abc', '0223456789', '+++']) {
      const result = await sendViaWapilot(junk, 'hi', { apiKey: 'K', instance: 'i' });
      assert.equal(result.ok, false, junk);
      assert.equal(result.reason, 'invalid_number', junk);
    }
  } finally { restore(); }
});

test('an address that already carries a suffix is not given a second one', async () => {
  const captured = {};
  const restore = stubFetch({ json: { success: true } }, captured);
  try {
    await sendViaWapilot('201012345678@c.us', 'hi', { apiKey: 'K', instance: 'i' });
    assert.equal(captured.body.chat_id, '201012345678@c.us');
  } finally { restore(); }
});

test('the send path and body field names are configurable per channel', async () => {
  // The whole reason this is configuration: when the real spec arrives it is a
  // settings change, not a deploy.
  const captured = {};
  const restore = stubFetch({ json: { success: true } }, captured);
  try {
    await sendViaWapilot('201012345678', 'hi', {
      apiKey: 'K', instance: 'inst9',
      sendPath: 'custom/{instance}/text', recipientField: 'to', messageField: 'body',
    });
    assert.equal(captured.url, `${BASE}/custom/inst9/text`);
    assert.deepEqual(captured.body, { to: '201012345678@c.us', body: 'hi' });
  } finally { restore(); }
});

test('the send URL is exactly the one the API answers on', async () => {
  // Pinned as a literal because the mistake that cost the most here was one
  // extra path segment: /v2/instances/{i}/send-message returns a catch-all
  // NOT_FOUND, while /v2/{i}/send-message is the real endpoint.
  const captured = {};
  const restore = stubFetch({ json: { success: true } }, captured);
  try {
    await sendViaWapilot('201012345678', 'hi', { apiKey: 'K', instance: 'instance5000' });
    assert.equal(captured.url, 'https://api.wapilot.net/api/v2/instance5000/send-message');
    assert.ok(!captured.url.includes('/instances/'), 'the send path has no /instances/ segment');
  } finally { restore(); }
});

test('the request carries the field names the API validates on', async () => {
  // Posting an empty body to the live endpoint returns 422 naming chat_id and
  // text; anything else silently fails validation.
  const captured = {};
  const restore = stubFetch({ json: { success: true } }, captured);
  try {
    await sendViaWapilot('201012345678', 'أهلاً', { apiKey: 'K', instance: 'i' });
    assert.deepEqual(Object.keys(captured.body).sort(), ['chat_id', 'text']);
  } finally { restore(); }
});

test('the default path substitutes the instance', async () => {
  const captured = {};
  const restore = stubFetch({ json: { success: true } }, captured);
  try {
    await sendViaWapilot('201012345678', 'hi', { apiKey: 'K', instance: 'instance5000' });
    assert.equal(captured.url, `${BASE}/${DEFAULT_SEND_PATH.replace('{instance}', 'instance5000')}`);
    assert.ok(!captured.url.includes('{instance}'), 'the placeholder must not survive into the URL');
  } finally { restore(); }
});

test('a 422 surfaces the API\'s own per-field errors', async () => {
  // Wapilot answers a bad request with a per-field errors object. That detail is
  // the difference between "لم يتم الإرسال" and knowing what to fix.
  const restore = stubFetch({ ok: false, status: 422, json: {
    success: false, message: 'Validation failed.',
    errors: { chat_id: ['The chat id field is required.'] },
  } });
  try {
    const result = await sendViaWapilot('201012345678', 'hi', { apiKey: 'K', instance: 'i' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /chat id field is required/);
  } finally { restore(); }
});

test('a rejected key says so rather than reporting a generic failure', async () => {
  const restore = stubFetch({ ok: false, status: 401, json: { success: false } });
  try {
    const result = await sendViaWapilot('201012345678', 'hi', { apiKey: 'K', instance: 'i' });
    assert.match(result.reason, /مفتاح/);
  } finally { restore(); }
});

test('success:false in a 200 body is still a failure', async () => {
  // The API answers 200 with success:false for application errors; treating
  // that as delivered would mark the channel connected on a failed send.
  const restore = stubFetch({ json: { success: false, message: 'Instance not found.' } });
  try {
    const result = await sendViaWapilot('201012345678', 'hi', { apiKey: 'K', instance: 'i' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'Instance not found.');
  } finally { restore(); }
});

test('the instance list exposes the subscription end date', async () => {
  // A lapsed subscription stops delivery while status still reads WORKING —
  // without surfacing this, the channel looks healthy and sends nothing.
  const restore = stubFetch({ json: { success: true, instances: [{
    instance_uniquename: 'instance5000', instance_name: 'mahad', status: 'WORKING',
    me_id: '201200400031@c.us', subscription_status: 'active',
    subscription: { end_date: '2026-08-04T13:05:50.000000Z' },
  }] } });
  try {
    const result = await listWapilotInstances('K');
    assert.equal(result.ok, true);
    assert.equal(result.instances[0].uniqueName, 'instance5000');
    assert.equal(result.instances[0].number, '201200400031');
    assert.equal(result.instances[0].subscriptionEndsAt, '2026-08-04T13:05:50.000000Z');
  } finally { restore(); }
});

// ── A throttled send is not a broken channel ────────────────────────────────
// Regression: Wapilot answered "Too Many Attempts." to one send, the channel
// was marked `error`, getSendableChannel only accepts `connected`, and WhatsApp
// OTP stayed dead for every user afterwards while the provider session was
// WORKING the whole time. Only failures that will still be failures next
// minute may take a channel out of service.
test('a throttled or unreachable provider does not take the channel out of service', () => {
  const { isTransientSendFailure } = require('../lib/whatsapp');

  for (const transient of [
    'Too Many Attempts.',
    'rate limit exceeded',
    'HTTP 429',
    'request timeout',
    'socket hang up',
    'ECONNRESET',
    'HTTP 503 Service Unavailable',
    { message: 'Gateway Timeout' },
  ]) {
    assert.equal(isTransientSendFailure(transient), true, `expected transient: ${JSON.stringify(transient)}`);
  }

  for (const permanent of [
    'Instance not found.',
    'Unauthenticated.',
    'invalid api key',
    'chat_id is required',
    { error: { message: 'The given data was invalid.' } },
  ]) {
    assert.equal(isTransientSendFailure(permanent), false, `expected permanent: ${JSON.stringify(permanent)}`);
  }
});

// ── One order, many payment attempts ────────────────────────────────────────
// Paymob refuses a special_reference it has seen before, and checkout-intent is
// idempotent on purpose, so the reference had to become unique per attempt.
// The webhook still has to find the order it belongs to.
test('the webhook resolves an order from a per-attempt payment reference', () => {
  const { paymobMerchantOrderId } = require('../lib/paymobHmac');
  const orderId = 'a89ab671-a00a-4508-96a5-8ce93949dc5a';

  // first attempt and a retry both point at the same order
  assert.strictEqual(paymobMerchantOrderId({ merchant_order_id: `${orderId}~m1k2j3` }), orderId);
  assert.strictEqual(paymobMerchantOrderId({ merchant_order_id: `${orderId}~zzzzzz` }), orderId);
  // a reference with no suffix (legacy orders, and the classic flow) still works
  assert.strictEqual(paymobMerchantOrderId({ merchant_order_id: orderId }), orderId);
  // the separator never appears inside a UUID, so nothing is truncated wrongly
  assert.ok(!orderId.includes('~'));
});
