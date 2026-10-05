'use strict';
/**
 * A WhatsApp campaign's funnel: sent → delivered → read → replied, from the
 * outbox receipts and the customer writing back afterwards. Real MariaDB.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-funnel-it';
let pool; let router;

async function get(route, params = {}) {
  const layer = router.stack.find(item => item.route?.path === route && item.route.methods.get);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await layer.route.stack.at(-1).handle({ params, query: {}, body: {}, headers: {}, tenantId: TENANT, user: { uid: 'u' }, isSuperAdmin: true, get: () => undefined }, res);
  return res;
}

async function clean() {
  await pool.query('DELETE FROM whatsapp_campaign_recipients WHERE tenant_id=?', [TENANT]).catch(() => {});
  for (const table of ['whatsapp_campaigns', 'message_outbox', 'inbox_threads']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  router = require('../../routes/whatsapp-campaigns');
  await pool.query(
    `INSERT INTO whatsapp_campaigns (id, tenant_id, name, message_template, status, recipient_count, sent_count)
     VALUES ('cp-f-1', ?, 'عرض أكتوبر', 'أهلاً {{name}}', 'sent', 4, 3)`, [TENANT]);
  // a: read and replied · b: delivered · c: sent only · d: still queued
  const outbox = [
    ['ob-f-a', '201020000001', "NOW() - INTERVAL 2 HOUR", 'read', 'NOW() - INTERVAL 110 MINUTE', 'NOW() - INTERVAL 100 MINUTE'],
    ['ob-f-b', '201020000002', "NOW() - INTERVAL 2 HOUR", 'delivered', 'NOW() - INTERVAL 110 MINUTE', 'NULL'],
    ['ob-f-c', '201020000003', "NOW() - INTERVAL 2 HOUR", 'sent', 'NULL', 'NULL'],
    ['ob-f-d', '201020000004', 'NULL', null, 'NULL', 'NULL'],
  ];
  for (const [id, phone, sentAt, delivery, deliveredAt, readAt] of outbox) {
    await pool.query(
      `INSERT INTO message_outbox (id, tenant_id, channel, recipient, payload_json, status, sent_at, delivery_status, delivered_at, read_at, ref_type, ref_id)
       VALUES (?, ?, 'whatsapp', ?, '{}', ?, ${sentAt}, ?, ${deliveredAt}, ${readAt}, 'whatsapp_campaign', 'cp-f-1')`,
      [id, TENANT, phone, sentAt === 'NULL' ? 'pending' : 'sent', delivery]);
    await pool.query(
      `INSERT INTO whatsapp_campaign_recipients (id, tenant_id, campaign_id, subject_type, phone, status, outbox_id)
       VALUES (UUID(), ?, 'cp-f-1', 'manual', ?, ?, ?)`, [TENANT, phone, sentAt === 'NULL' ? 'queued' : 'sent', id]);
  }
  // a wrote back after the campaign; b wrote, but the day before it.
  await pool.query(
    `INSERT INTO inbox_threads (id, tenant_id, platform, contact_key, status, last_inbound_at) VALUES
       ('th-f-a', ?, 'whatsapp', '201020000001', 'open', NOW() - INTERVAL 30 MINUTE),
       ('th-f-b', ?, 'whatsapp', '201020000002', 'open', NOW() - INTERVAL 1 DAY)`, [TENANT, TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('the list carries delivered, read and replied', { skip }, async () => {
  const res = await get('/api/admin/whatsapp-campaigns');
  const campaign = res.body.find(c => c.id === 'cp-f-1');
  assert.deepEqual([campaign.delivered_count, campaign.read_count, campaign.replied_count], [2, 1, 1]);
});

test('each recipient shows how far their message got', { skip }, async () => {
  const res = await get('/api/admin/whatsapp-campaigns/:id/recipients', { id: 'cp-f-1' });
  const by = Object.fromEntries(res.body.map(r => [r.phone, [Number(r.delivered) || 0, Number(r.was_read) || 0, Number(r.replied) || 0]]));
  assert.deepEqual(by['201020000001'], [1, 1, 1]);
  assert.deepEqual(by['201020000002'], [1, 0, 0]);
  assert.deepEqual(by['201020000003'], [0, 0, 0]);
  assert.deepEqual(by['201020000004'], [0, 0, 0]);
});
