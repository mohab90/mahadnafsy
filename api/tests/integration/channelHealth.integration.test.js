'use strict';
/**
 * 4 Nov 2026: GET /api/admin/messaging/channels/health says what receiving needs (the webhook addresses, whether the server holds the secrets) and when the last message
 * arrived on each channel — the proof that a «connected» channel really brings customers' messages into the shared inbox. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-channel-health-it';
let pool, router;

const clean = () => pool.query('DELETE FROM communications WHERE tenant_id=?', [T]).catch(() => {});
const get = async host => {
  const layer = router.stack.find(l => l.route?.path === '/api/admin/messaging/channels/health');
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({
    params: {}, query: {}, body: {}, headers: {}, tenantId: T, user: { uid: 'admin' }, staffRecord: null, isSuperAdmin: true, ip: '1',
    get: name => (name === 'host' ? host : undefined),
  }, res);
  return res;
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/messaging-channels');
  await clean();
  await pool.query(
    `INSERT INTO communications (id, tenant_id, type, direction, provider_message_id, channel_id, date, notes, created_at) VALUES
       ('ch-c1', ?, 'WHATSAPP', 'IN', 'wamid.1', 'chan-a', CURDATE(), 'مرحبا', NOW()),
       ('ch-c2', ?, 'WHATSAPP', 'IN', 'wamid.2', 'chan-a', CURDATE(), 'تاني', NOW() - INTERVAL 10 DAY),
       ('ch-c3', ?, 'WHATSAPP', 'OUT', 'wamid.3', 'chan-b', CURDATE(), 'رد', NOW())`, [T, T, T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the webhook addresses are the ones this host serves, and each channel shows what arrived on it', { skip }, async () => {
  const { body, statusCode } = await get('admin.example.test');
  assert.equal(statusCode, 200);
  assert.equal(body.webhooks.whatsapp.url, 'https://admin.example.test/api/webhooks/whatsapp/meta');
  assert.equal(body.webhooks.messenger.url, 'https://admin.example.test/api/webhooks/messenger');
  assert.equal(typeof body.webhooks.whatsapp.appSecret, 'boolean');
  assert.equal(typeof body.webhooks.whatsapp.verifyToken, 'boolean');
  assert.equal(body.channels['chan-a'].inboundThisWeek, 1, 'the ten-day-old message is not this week\'s');
  assert.ok(body.channels['chan-a'].lastInboundAt);
  assert.equal(body.channels['chan-b'], undefined, 'a channel that only sent has received nothing');
});
