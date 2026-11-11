'use strict';

// 12 Nov 2026: the owner typed his business token (the one WhatsApp uses) into the Messenger channel and it read «التوكن ده مش بتاع الصفحة المحددة».
// A token that manages the page can hand over the page's own token: the check now asks for it, uses it and gives it back to be saved.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-secret-0123456789abcdef';
const { verifyMessengerCredentials } = require('../lib/messenger');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('a business token that manages the page is exchanged for the page\'s own token, which subscribes the page', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url: String(url), body: String(options.body || '') });
    if (String(url).includes('/me?')) return json({ id: 'system-user-9', name: 'System User' });
    if (String(url).includes('/page-1?fields=access_token')) return json({ access_token: 'the-page-token', name: 'معهد الدراسات النفسية', id: 'page-1' });
    return json({ success: true });
  });
  const check = await verifyMessengerCredentials({ pageAccessToken: 'business-token', pageId: 'page-1' });
  assert.equal(check.ok, true);
  assert.equal(check.pageId, 'page-1');
  assert.equal(check.pageName, 'معهد الدراسات النفسية');
  assert.equal(check.correctedPageToken, 'the-page-token', 'handed back so the channel keeps the page\'s token');
  assert.equal(check.subscribed, true);
  const subscribe = calls.find(call => call.url.endsWith('/page-1/subscribed_apps'));
  assert.ok(subscribe && subscribe.body.includes('access_token=the-page-token'), 'the page is subscribed with its own token, not the business one');
});

test('a token that cannot reach the page says what to do in Meta, and nothing is subscribed', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    if (String(url).includes('/me?')) return json({ id: 'system-user-9', name: 'System User' });
    return json({ error: { message: '(#200) Requires pages_read_engagement permission', code: 200 } }, 403);
  });
  const check = await verifyMessengerCredentials({ pageAccessToken: 'business-token', pageId: 'page-1' });
  assert.equal(check.ok, false);
  assert.match(check.reason, /Add assets/);
  assert.match(check.reason, /pages_messaging/);
  assert.match(check.reason, /pages_read_engagement permission/, 'Facebook\'s own answer is kept beside the steps');
  assert.equal(check.correctedPageToken, undefined);
  assert.ok(!calls.some(url => url.includes('subscribed_apps')));
});

test('the page\'s own token is used as it is: no exchange, nothing to correct', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    if (String(url).includes('/me?')) return json({ id: 'page-1', name: 'معهد الدراسات النفسية' });
    return json({ success: true });
  });
  const check = await verifyMessengerCredentials({ pageAccessToken: 'page-token', pageId: 'page-1' });
  assert.equal(check.ok, true);
  assert.equal(check.correctedPageToken, undefined);
  assert.ok(!calls.some(url => url.includes('fields=access_token')));
});
