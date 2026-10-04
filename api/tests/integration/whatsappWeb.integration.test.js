'use strict';
/**
 * The «واتساب» tab against a real MariaDB, with a fake phone connection in
 * place of WhatsApp: a message seen twice is stored once; opening a chat
 * matches its number to the lead however the number was spelled; a send from
 * the tab is counted as the rep's, lands on the lead's timeline once, and a
 * rep sees only their own chats and counts. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
process.env.WA_WEB_MIN_GAP_MS = '0';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-wa-web-it';
const LEAD_JID = '201012345678@s.whatsapp.net';
let pool, wa, store, router;

async function clean() {
  for (const table of ['wa_web_messages', 'wa_web_chats', 'wa_web_sessions', 'communications', 'leads', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

const handler = (method, path) => {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, path);
  return layer.route.stack.at(-1).handle;
};
async function call(method, path, { staffId, query = {}, body = {}, all = false } = {}) {
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await handler(method, path)({
    params: {}, body, query, headers: {}, tenantId: TENANT, user: { uid: staffId },
    staffRecord: all ? null : { id: staffId, role: 'sales' }, isSuperAdmin: all, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  wa = require('../../lib/whatsappWeb');
  store = require('../../lib/whatsappWebStore');
  router = require('../../routes/whatsapp-web');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('wa-rep-1', ?, 'سارة', 'wa1@example.test', '1019000001', 'SALES', 1, '2025-01-01'),
       ('wa-rep-2', ?, 'أحمد', 'wa2@example.test', '1019000002', 'SALES', 1, '2025-01-01')`, [TENANT, TENANT]);
  // Stored the way an old sheet wrote it: national, with the leading zero.
  await pool.query(
    "INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, created_at) VALUES ('wa-lead', ?, 'منى', '01012345678', 'فيسبوك', 'new', 0, NOW())",
    [TENANT]);
});
after(async () => { if (ENABLED) { wa._testing.reset(); await clean(); await pool.end(); } });

const incoming = (id, text, seconds) => ({
  key: { id, remoteJid: LEAD_JID, fromMe: false }, message: { conversation: text }, messageTimestamp: seconds, pushName: 'Mona',
});

test('a message reported twice is stored once, and counts as unread until the chat is opened', { skip }, async () => {
  const now = Math.floor(Date.now() / 1000);
  const rows = [incoming('IN-1', 'عايزة أعرف سعر الكورس', now - 60), incoming('IN-2', 'لو سمحت', now - 30)].map(store.parseWaMessage);
  assert.equal((await store.recordMessages(TENANT, 'wa-rep-1', rows)).length, 2);
  assert.equal((await store.recordMessages(TENANT, 'wa-rep-1', rows)).length, 0, 'the same ids again');
  const { body } = await call('get', '/api/staff/whatsapp-web/chats', { staffId: 'wa-rep-1' });
  assert.equal(body.chats.length, 1);
  assert.equal(body.chats[0].unread, 2);
  assert.equal(body.chats[0].lastMessage, 'لو سمحت');
  assert.equal(body.chats[0].name, 'Mona');
});

test('opening the chat reads it and matches the number to the lead, however it was spelled', { skip }, async () => {
  const { body } = await call('get', '/api/staff/whatsapp-web/messages', { staffId: 'wa-rep-1', query: { jid: LEAD_JID } });
  assert.deepEqual(body.messages.map(m => m.body), ['عايزة أعرف سعر الكورس', 'لو سمحت']);
  assert.equal(body.leadId, 'wa-lead');
  const chats = (await call('get', '/api/staff/whatsapp-web/chats', { staffId: 'wa-rep-1', query: { q: 'منى' } })).body.chats;
  assert.equal(chats.length, 1, 'searchable by the lead\'s CRM name');
  assert.equal(chats[0].unread, 0);
  assert.equal(chats[0].crmName, 'منى');
});

test('a send from the tab is the rep\'s, counted, and on the lead\'s timeline once — even when the phone echoes it first', { skip }, async () => {
  const sent = [];
  const fakeSock = {
    async sendMessage(jid, content) {
      const message = { key: { id: `OUT-${sent.length + 1}`, remoteJid: jid, fromMe: true }, message: { conversation: content.text }, messageTimestamp: Math.floor(Date.now() / 1000) };
      sent.push([jid, content.text]);
      // The phone's own copy arrives before sendMessage returns.
      await store.recordMessages(TENANT, 'wa-rep-1', [store.parseWaMessage(message)], { countUnread: false });
      return message;
    },
    async onWhatsApp() { return [{ exists: true }]; },
  };
  wa._testing.attach(TENANT, 'wa-rep-1', fakeSock);
  const res = await call('post', '/api/staff/whatsapp-web/send', { staffId: 'wa-rep-1', body: { jid: LEAD_JID, text: 'السعر 2800 جنيه' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.message.sentToday, 1);
  assert.deepEqual(sent, [[LEAD_JID, 'السعر 2800 جنيه']]);

  const [[row]] = await pool.query("SELECT sent_by_system FROM wa_web_messages WHERE tenant_id=? AND wa_id='OUT-1'", [TENANT]);
  assert.equal(row.sent_by_system, 1);
  const [comms] = await pool.query('SELECT lead_id, direction, notes, staff_id FROM communications WHERE tenant_id=?', [TENANT]);
  assert.deepEqual(comms.map(c => [c.lead_id, c.direction, c.notes, c.staff_id]), [['wa-lead', 'OUT', 'السعر 2800 جنيه', 'wa-rep-1']]);

  // By typed number: the address is built from it.
  const byPhone = await call('post', '/api/staff/whatsapp-web/send', { staffId: 'wa-rep-1', body: { phone: '0101 234 5678', text: 'تاني' } });
  assert.equal(byPhone.statusCode, 200);
  assert.equal(sent[1][0], LEAD_JID);
});

test('a rep with no linked phone is told to link it; an empty message is refused', { skip }, async () => {
  const notLinked = await call('post', '/api/staff/whatsapp-web/send', { staffId: 'wa-rep-2', body: { jid: LEAD_JID, text: 'x' } });
  assert.equal(notLinked.statusCode, 409);
  assert.equal(notLinked.body.code, 'WA_WEB_NOT_LINKED');
  const empty = await call('post', '/api/staff/whatsapp-web/send', { staffId: 'wa-rep-1', body: { jid: LEAD_JID, text: '  ' } });
  assert.equal(empty.statusCode, 400);
});

test('counts: a rep sees their own; a manager sees everyone\'s; chats are never shared', { skip }, async () => {
  await store.recordMessages(TENANT, 'wa-rep-2', [store.parseWaMessage(incoming('IN-9', 'مرحبا', Math.floor(Date.now() / 1000)))]);
  const mine = (await call('get', '/api/staff/whatsapp-web/stats', { staffId: 'wa-rep-1' })).body;
  assert.equal(mine.everyone, false);
  assert.deepEqual(mine.rows.map(r => [r.staffId, r.sentBySystem, r.sentFromPhone, r.received]), [['wa-rep-1', 2, 0, 2]]);
  assert.equal(mine.rows[0].staffName, 'سارة');
  const all = (await call('get', '/api/staff/whatsapp-web/stats', { staffId: 'owner', all: true })).body;
  assert.deepEqual(all.rows.map(r => r.staffId).sort(), ['wa-rep-1', 'wa-rep-2']);
  const other = (await call('get', '/api/staff/whatsapp-web/chats', { staffId: 'wa-rep-2' })).body.chats;
  assert.deepEqual(other.map(c => c.lastMessage), ['مرحبا'], 'rep 2 does not see rep 1\'s conversation');
});
