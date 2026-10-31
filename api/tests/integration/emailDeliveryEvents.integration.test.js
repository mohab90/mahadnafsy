'use strict';
/**
 * What the mail relay reports is kept and acted on (31 Oct 2026 audit): a bounce, a block and a spam report put the address
 * on the do-not-mail list the campaigns filter through; the same event delivered twice is one row; the webhook answers only
 * to its token. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
process.env.BREVO_WEBHOOK_TOKEN = 'it-brevo-token';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-email-events-it';
let pool; let router; let lib;

async function post(query, body, headers = {}) {
  const layer = router.stack.find(item => item.route?.path === '/api/webhooks/brevo' && item.route.methods.post);
  assert.ok(layer, 'webhook route');
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  const handler = layer.route.stack.at(-1).handle;
  await handler({ query, body, headers, tenantId: TENANT }, res);
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  lib = require('../../lib/emailDelivery');
  router = require('../../routes/email-webhook');
  await pool.query('DELETE FROM email_delivery_events WHERE tenant_id=?', [TENANT]);
  await pool.query('DELETE FROM marketing_suppressions WHERE tenant_id=?', [TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await pool.query('DELETE FROM email_delivery_events WHERE tenant_id=?', [TENANT]);
  await pool.query('DELETE FROM marketing_suppressions WHERE tenant_id=?', [TENANT]);
  await pool.end();
});

test('events are read from one object or a list, and what is not an event is dropped', () => {
  const { parseEvents } = require('../../lib/emailDelivery');
  const rows = parseEvents([
    { event: 'delivered', email: 'A@Example.com', 'message-id': '<m1@x>', ts_event: 1793500000, subject: 'إيصال' },
    { event: 'hard_bounce', email: 'gone@example.com', 'message-id': '<m2@x>', reason: 'mailbox does not exist', date: '2026-10-31 22:00:00' },
    { event: 'invalid_email', email: 'bad@example.com', 'message-id': '<m3@x>' },
    { event: 'unsubscribe', email: 'stop@example.com' },
    { event: 'something_new', email: 'x@example.com' },
    { event: 'delivered', email: 'not-an-address' },
    { event: 'delivered' },
  ]);
  assert.deepEqual(rows.map(row => [row.event, row.email]), [
    ['delivered', 'a@example.com'], ['hard_bounce', 'gone@example.com'], ['hard_bounce', 'bad@example.com'], ['unsubscribed', 'stop@example.com'],
  ]);
  assert.equal(rows[0].occurredAt, new Date(1793500000 * 1000).toISOString().slice(0, 19).replace('T', ' '), 'the epoch, not the relay\'s local clock');
  assert.equal(parseEvents(null).length, 0);
  assert.equal(parseEvents('x').length, 0);
});

test('the webhook refuses a call without the token and answers 503 when none is configured', { skip }, async () => {
  assert.equal((await post({}, { event: 'delivered', email: 'a@example.com' })).statusCode, 401);
  assert.equal((await post({ token: 'wrong' }, { event: 'delivered', email: 'a@example.com' })).statusCode, 401);
  const saved = process.env.BREVO_WEBHOOK_TOKEN;
  delete process.env.BREVO_WEBHOOK_TOKEN;
  assert.equal((await post({ token: 'x' }, {})).statusCode, 503);
  process.env.BREVO_WEBHOOK_TOKEN = saved;
});

test('the token is accepted in the query, in a header, or as a basic-auth password', { skip }, async () => {
  const body = { event: 'delivered', email: 'ok@example.com', 'message-id': '<t1@x>', ts_event: 1793500001 };
  assert.equal((await post({ token: 'it-brevo-token' }, body)).statusCode, 200);
  assert.equal((await post({}, body, { 'x-webhook-token': 'it-brevo-token' })).statusCode, 200);
  const basic = Buffer.from('brevo:it-brevo-token').toString('base64');
  assert.equal((await post({}, body, { authorization: `Basic ${basic}` })).statusCode, 200);
});

test('a bounce, a block and a spam report put the address on the do-not-mail list; a delivery does not', { skip }, async () => {
  const res = await post({ token: 'it-brevo-token' }, [
    { event: 'hard_bounce', email: 'dead@example.com', 'message-id': '<b1@x>', reason: 'no such user', ts_event: 1793500100 },
    { event: 'blocked', email: 'blocked@example.com', 'message-id': '<b2@x>', ts_event: 1793500101 },
    { event: 'spam', email: 'angry@example.com', 'message-id': '<b3@x>', ts_event: 1793500102 },
    { event: 'soft_bounce', email: 'full@example.com', 'message-id': '<b4@x>', ts_event: 1793500103 },
    { event: 'delivered', email: 'fine@example.com', 'message-id': '<b5@x>', ts_event: 1793500104 },
  ]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.stored, 5);
  assert.equal(res.body.suppressed, 3);
  const { isSuppressed } = require('../../lib/marketingConsent');
  for (const address of ['dead@example.com', 'blocked@example.com', 'angry@example.com']) {
    assert.equal(await isSuppressed(TENANT, 'email', address), true, address);
  }
  for (const address of ['full@example.com', 'fine@example.com']) {
    assert.equal(await isSuppressed(TENANT, 'email', address), false, address);
  }
});

test('the relay retrying an event does not count it twice', { skip }, async () => {
  const event = { event: 'hard_bounce', email: 'retry@example.com', 'message-id': '<r1@x>', ts_event: 1793500200 };
  assert.equal((await post({ token: 'it-brevo-token' }, event)).body.stored, 1);
  assert.equal((await post({ token: 'it-brevo-token' }, event)).body.stored, 0);
  const [[row]] = await pool.query("SELECT COUNT(*) AS n FROM email_delivery_events WHERE tenant_id=? AND email='retry@example.com'", [TENANT]);
  assert.equal(Number(row.n), 1);
});

test('the summary counts the events, the share that did not arrive, and lists the latest problems', { skip }, async () => {
  // Re-stamp to now so the 7-day window holds them whatever the clock of the machine running the test.
  await pool.query("UPDATE email_delivery_events SET occurred_at=UTC_TIMESTAMP() WHERE tenant_id=?", [TENANT]);
  const s = await lib.summary(TENANT, 7);
  assert.equal(s.counts.delivered, 2, 'the three calls with the same message are one row');
  assert.ok(s.counts.hard_bounce >= 2);
  assert.ok(s.failureShare > 0 && s.failureShare < 100);
  assert.ok(s.recent.some(row => row.email === 'dead@example.com' && row.event === 'hard_bounce' && row.reason === 'no such user'));
  assert.ok(!s.recent.some(row => row.event === 'delivered'));
});
