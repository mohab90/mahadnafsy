'use strict';
/**
 * The SMS provider's webhook_url is a platform setting, and it was fetched as
 * it was written: a URL pointing at the server's own network (127.0.0.1, a
 * cloud metadata address, the database host) got a POST carrying the API key.
 * It goes through lib/webhookSecurity.js postWebhook now, like every tenant
 * webhook. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { sendSmsOtp } = require('../lib/otpProvider');

test('a webhook on a loopback address is refused and never receives the code', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => { hits += 1; res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const fetchBefore = global.fetch;
  let fetched = false;
  global.fetch = async () => { fetched = true; return { ok: true, status: 200, json: async () => ({}) }; };
  try {
    const result = await sendSmsOtp({
      phone: '01012345678',
      message: 'code 123456',
      settings: { sms: { enabled: true, provider: 'webhook', webhook_url: `http://127.0.0.1:${port}/sms`, api_key: 'k' } },
    });
    assert.equal(result.ok, false);
    assert.match(String(result.reason), /webhook_refused/);
    assert.equal(hits, 0, 'the private address was contacted');
    assert.equal(fetched, false, 'the raw fetch path is still in use');
  } finally {
    global.fetch = fetchBefore;
    await new Promise(resolve => server.close(resolve));
  }
});

test('a private address written as a public-looking provider is refused before any request', async () => {
  const result = await sendSmsOtp({
    phone: '01012345678',
    message: 'code',
    settings: { sms: { enabled: true, webhook_url: 'https://169.254.169.254/latest/meta-data' } },
  });
  assert.equal(result.ok, false);
  assert.match(String(result.reason), /Private webhook/);
});
