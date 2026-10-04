'use strict';
/**
 * «صندوق الرسائل» against a real MariaDB, with Meta's API replaced by a fake:
 *   - a message to the company number opens a conversation with the lead's rep;
 *     a colleague neither sees it nor can open it
 *   - a conversation nobody owns is taken by whoever answers it first, and the
 *     reply goes out from the company number, lands on the timeline with
 *     Meta's id, and takes WhatsApp's ticks forward only
 *   - after 24 hours a text is refused and a template goes instead
 *   - «إلغاء» takes the number off promotional campaigns
 *   - an Instagram message lands as a lead and a conversation of its own
 *   - a rep can hand their conversation to a colleague
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
process.env.WHATSAPP_OUTBOUND_CATEGORIES = 'all';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-team-inbox-it';
const LEAD_PHONE = '201012340001';
const CLIENT_PHONE = '201012340002';
let pool, router, inbound, messenger, delivery, campaigns;

const sent = [];
let sends = 0;
const realFetch = global.fetch;

async function clean() {
  await pool.query('DELETE FROM marketing_suppressions WHERE tenant_id=?', [TENANT]).catch(() => {});
  await pool.query('DELETE FROM marketing_consent_audit WHERE tenant_id=?', [TENANT]).catch(() => {});
  for (const table of ['notifications', 'inbox_threads', 'communications', 'messaging_channels', 'leads', 'subscribers', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

const handler = (method, path) => {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, path);
  return layer.route.stack.at(-1).handle;
};
async function call(method, path, { staffId, params = {}, query = {}, body = {}, all = false } = {}) {
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await handler(method, path)({
    params, body, query, headers: {}, tenantId: TENANT, user: { uid: staffId },
    staffRecord: { id: staffId, name: staffId, role: all ? 'admin' : 'sales', data_scope: all ? 'all' : null },
    isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}
const thread = async contactKey => {
  const [[row]] = await pool.query('SELECT * FROM inbox_threads WHERE tenant_id=? AND contact_key=?', [TENANT, contactKey]);
  return row;
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/team-inbox');
  inbound = require('../../lib/whatsappInbound');
  messenger = require('../../lib/messenger');
  delivery = require('../../lib/whatsappDelivery');
  campaigns = require('../../lib/whatsappCampaigns');
  const channels = require('../../lib/messagingChannels');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('ti-rep-1', ?, 'سارة', 'ti1@example.test', '1019100001', 'SALES', 1, '2025-01-01'),
       ('ti-rep-2', ?, 'أحمد', 'ti2@example.test', '1019100002', 'SALES', 1, '2025-01-01')`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, assigned_sales_id, created_at)
     VALUES ('ti-lead', ?, 'منى', '01012340001', 'فيسبوك', 'new', 0, 'ti-rep-1', NOW())`, [TENANT]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, is_active, created_at)
     VALUES ('ti-client', ?, 'هالة', '01012340002', 1, NOW())`, [TENANT]);
  const channel = await channels.createChannel({
    tenantId: TENANT, kind: 'whatsapp', provider: 'meta', label: 'رقم الشركة',
    credentials: { metaPhoneId: 'PHONE-ID-TI', metaToken: 'token', metaWabaId: 'WABA-TI' }, makeDefault: true,
  });
  await channels.markChannelConnected(TENANT, channel.id);
  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    sent.push({ url: String(url), body });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.TI${++sends}` }] }) };
  };
});
after(async () => { if (ENABLED) { global.fetch = realFetch; await clean(); await pool.end(); } });

test('a message to the company number opens a conversation with the lead\'s own rep, closed to colleagues', { skip }, async () => {
  const channel = await require('../../lib/messagingChannels').channelByExternalId('PHONE-ID-TI');
  assert.equal(channel.tenant_id, TENANT, 'the webhook is filed under the number it came to');
  const result = await inbound.recordInboundMessage({
    tenantId: TENANT, channelId: channel.id, providerMessageId: 'wa-in-1', from: LEAD_PHONE,
    body: 'عايزة أعرف مواعيد الكورس', timestamp: Math.floor(Date.now() / 1000),
  });
  assert.equal(result.recorded, true);
  const row = await thread(LEAD_PHONE);
  assert.equal(row.assigned_staff_id, 'ti-rep-1');
  assert.equal(row.unread_count, 1);
  assert.equal(row.lead_id, 'ti-lead');

  const mine = await call('get', '/api/admin/team-inbox/threads', { staffId: 'ti-rep-1' });
  assert.equal(mine.body.threads.length, 1);
  assert.equal(mine.body.threads[0].windowOpen, true);
  const theirs = await call('get', '/api/admin/team-inbox/threads', { staffId: 'ti-rep-2', query: { view: 'all' } });
  assert.equal(theirs.body.threads.length, 0, 'a colleague does not see it');
  const peek = await call('get', '/api/admin/team-inbox/threads/:id', { staffId: 'ti-rep-2', params: { id: row.id } });
  assert.equal(peek.statusCode, 403);

  const open = await call('get', '/api/admin/team-inbox/threads/:id', { staffId: 'ti-rep-1', params: { id: row.id } });
  assert.equal(open.body.messages.length, 1);
  assert.equal((await thread(LEAD_PHONE)).unread_count, 0, 'opening your own marks it read');
});

test('nobody\'s conversation is taken by whoever answers first; the reply carries Meta\'s ticks', { skip }, async () => {
  await inbound.recordInboundMessage({
    tenantId: TENANT, providerMessageId: 'wa-in-2', from: CLIENT_PHONE, body: 'محتاجة الشهادة',
    timestamp: Math.floor(Date.now() / 1000),
  });
  const row = await thread(CLIENT_PHONE);
  assert.equal(row.assigned_staff_id, null, 'a client with no CS is nobody\'s yet');
  const queue = await call('get', '/api/admin/team-inbox/threads', { staffId: 'ti-rep-2', query: { view: 'unassigned' } });
  assert.deepEqual(queue.body.threads.map(t => t.id), [row.id]);

  sent.length = 0;
  const reply = await call('post', '/api/admin/team-inbox/threads/:id/reply',
    { staffId: 'ti-rep-2', params: { id: row.id }, body: { text: 'حاضر، هتوصلك النهارده' } });
  assert.equal(reply.statusCode, 200, JSON.stringify(reply.body));
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /PHONE-ID-TI\/messages$/, 'from the company number');
  assert.equal(sent[0].body.to, CLIENT_PHONE);
  const after = await thread(CLIENT_PHONE);
  assert.equal(after.assigned_staff_id, 'ti-rep-2');
  assert.equal(after.last_direction, 'OUT');

  const claim = await call('post', '/api/admin/team-inbox/threads/:id/claim', { staffId: 'ti-rep-1', params: { id: row.id } });
  assert.equal(claim.statusCode, 403, 'already taken by a colleague');

  const [[out]] = await pool.query(
    "SELECT provider_message_id, delivery_status, thread_id, subscriber_id FROM communications WHERE tenant_id=? AND id=?",
    [TENANT, reply.body.id]);
  assert.equal(out.thread_id, row.id);
  assert.equal(out.subscriber_id, 'ti-client', 'on the client\'s timeline');
  await delivery.applyDeliveryStatus({ provider: 'meta', tenantId: TENANT, messageId: out.provider_message_id, status: 'read' });
  await delivery.applyDeliveryStatus({ provider: 'meta', tenantId: TENANT, messageId: out.provider_message_id, status: 'delivered' });
  const [[ticked]] = await pool.query('SELECT delivery_status FROM communications WHERE tenant_id=? AND id=?', [TENANT, reply.body.id]);
  assert.equal(ticked.delivery_status, 'read', 'ticks only move forward');
});

test('after 24 hours a text is refused and an approved template goes instead', { skip }, async () => {
  const row = await thread(LEAD_PHONE);
  await pool.query('UPDATE inbox_threads SET last_inbound_at = NOW() - INTERVAL 2 DAY WHERE id=?', [row.id]);
  const text = await call('post', '/api/admin/team-inbox/threads/:id/reply',
    { staffId: 'ti-rep-1', params: { id: row.id }, body: { text: 'لسه مهتمة؟' } });
  assert.equal(text.statusCode, 409);
  assert.equal(text.body.code, 'WINDOW_CLOSED');

  sent.length = 0;
  const template = await call('post', '/api/admin/team-inbox/threads/:id/reply', {
    staffId: 'ti-rep-1', params: { id: row.id },
    body: { template: { name: 'follow_up', language: 'ar', params: ['منى', ''] } },
  });
  assert.equal(template.statusCode, 200, JSON.stringify(template.body));
  assert.equal(sent[0].body.type, 'template');
  assert.equal(sent[0].body.template.name, 'follow_up');
  assert.deepEqual(sent[0].body.template.components[0].parameters.map(p => p.text), ['منى', '-']);
});

test('«إلغاء» takes the number off promotional campaigns', { skip }, async () => {
  const before = await campaigns.buildAudience({ tenantId: TENANT, audience: 'leads' });
  assert.equal(before.recipients.length, 1);
  const result = await inbound.recordInboundMessage({
    tenantId: TENANT, providerMessageId: 'wa-in-3', from: LEAD_PHONE, body: 'إلغاء', timestamp: Math.floor(Date.now() / 1000),
  });
  assert.equal(result.optedOut, true);
  const later = await campaigns.buildAudience({ tenantId: TENANT, audience: 'leads' });
  assert.equal(later.recipients.length, 0);
  assert.equal(later.skipped[0].reason, 'ألغى الاشتراك');
  assert.equal(inbound.isOptOut('عايزة ألغي الحجز'), false, 'a question is not an unsubscribe');
});

test('an Instagram message becomes a lead and a conversation of its own', { skip }, async () => {
  const [message] = messenger.extractMessengerMessages({
    object: 'instagram',
    entry: [{ id: 'IG-ACCOUNT', messaging: [{ sender: { id: 'IGSID-1' }, timestamp: Date.now(), message: { mid: 'ig-mid-1', text: 'بكام الدبلومة؟' } }] }],
  });
  assert.equal(message.platform, 'instagram');
  const result = await messenger.recordInboundMessenger({ tenantId: TENANT, ...message });
  assert.equal(result.recorded, true);
  assert.equal(result.createdLead, true);
  const [[lead]] = await pool.query('SELECT source, instagram_id, instagram_last_inbound_at FROM leads WHERE tenant_id=? AND id=?', [TENANT, result.leadId]);
  assert.equal(lead.source, 'instagram_inbound');
  assert.equal(lead.instagram_id, 'IGSID-1');
  assert.ok(lead.instagram_last_inbound_at);
  const row = await thread('IGSID-1');
  assert.equal(row.platform, 'instagram');
  const [[comm]] = await pool.query('SELECT type, thread_id FROM communications WHERE tenant_id=? AND id=?', [TENANT, result.id]);
  assert.equal(comm.type, 'INSTAGRAM');
  assert.equal(comm.thread_id, row.id);
});

test('a rep hands their conversation to a colleague, who is told', { skip }, async () => {
  const row = await thread(LEAD_PHONE);
  const handOver = await call('post', '/api/admin/team-inbox/threads/:id/assign',
    { staffId: 'ti-rep-1', params: { id: row.id }, body: { staffId: 'ti-rep-2' } });
  assert.equal(handOver.statusCode, 200, JSON.stringify(handOver.body));
  assert.equal((await thread(LEAD_PHONE)).assigned_staff_id, 'ti-rep-2');
  const back = await call('post', '/api/admin/team-inbox/threads/:id/assign',
    { staffId: 'ti-rep-1', params: { id: row.id }, body: { staffId: 'ti-rep-1' } });
  assert.equal(back.statusCode, 403, 'no longer theirs to move');
  const [[note]] = await pool.query(
    "SELECT COUNT(*) AS n FROM notifications WHERE tenant_id=? AND type='inbox'", [TENANT]);
  assert.ok(note.n >= 1);
  const counts = await call('get', '/api/admin/team-inbox/counts', { staffId: 'ti-rep-2' });
  const [[own]] = await pool.query(
    "SELECT COUNT(*) AS n FROM inbox_threads WHERE tenant_id=? AND assigned_staff_id='ti-rep-2' AND status='open'", [TENANT]);
  assert.equal(counts.body.mine, Number(own.n));
  assert.ok(counts.body.mine >= 2);
  assert.equal(counts.body.all, null, 'a rep is not shown the whole company\'s count');
});
