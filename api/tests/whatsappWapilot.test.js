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

test('an address that already carries a suffix is not given a second one', async () => {
  const captured = {};
  const restore = stubFetch({ json: { success: true } }, captured);
  try {
    await sendViaWapilot('201012345678@c.us', 'hi', { apiKey: 'K', instance: 'i' });
    assert.equal(captured.body.chatId, '201012345678@c.us');
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

test('the default path substitutes the instance', async () => {
  const captured = {};
  const restore = stubFetch({ json: { success: true } }, captured);
  try {
    await sendViaWapilot('201012345678', 'hi', { apiKey: 'K', instance: 'instance5000' });
    assert.equal(captured.url, `${BASE}/${DEFAULT_SEND_PATH.replace('{instance}', 'instance5000')}`);
    assert.ok(!captured.url.includes('{instance}'), 'the placeholder must not survive into the URL');
  } finally { restore(); }
});

test('a 404 on send says the path is wrong rather than something vague', async () => {
  // The likeliest real failure while sendPath is still the placeholder — an
  // admin needs to be told what to change, not just that it failed.
  const restore = stubFetch({ ok: false, status: 404, json: { success: false, message: 'NOT_FOUND' } });
  try {
    const result = await sendViaWapilot('201012345678', 'hi', { apiKey: 'K', instance: 'i' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /مسار الإرسال/);
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
