'use strict';
/**
 * «ابعت STOP أو ستوب يوقف الرسايل، وابدأ يرجعها» (11 Oct 2026), against a real
 * MariaDB with Meta's API replaced by a fake:
 *   - «ستوب» from a lead records the opt-out where every promotion is checked,
 *     and is answered once — a second «ستوب» is not answered again
 *   - a promotion to that number is refused at send time; a receipt is not
 *   - «ابدأ» takes them back, answered once; from someone who never stopped it
 *     is just a message for the rep
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
const TENANT = 'tenant-wa-stop-it';
const LEAD_PHONE = '201012349901';
const CLIENT_PHONE = '201012349902';
let pool, inbound, whatsapp, consent, channelId;

const sent = [];
const realFetch = global.fetch;
const textsTo = number => sent.filter(item => item.body?.to === number).map(item => item.body.text?.body || item.body.template?.name);

async function clean() {
  await pool.query('DELETE FROM marketing_suppressions WHERE tenant_id=?', [TENANT]).catch(() => {});
  await pool.query('DELETE FROM marketing_consent_audit WHERE tenant_id=?', [TENANT]).catch(() => {});
  for (const table of ['notifications', 'inbox_threads', 'communications', 'messaging_channels', 'leads', 'subscribers']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}
let seq = 0;
const say = (from, body) => inbound.recordInboundMessage({
  tenantId: TENANT, channelId, providerMessageId: `wa-stop-${++seq}`, from, body, timestamp: Math.floor(Date.now() / 1000),
});

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  inbound = require('../../lib/whatsappInbound');
  whatsapp = require('../../lib/whatsapp');
  consent = require('../../lib/marketingConsent');
  const channels = require('../../lib/messagingChannels');
  await clean();
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, created_at)
     VALUES ('ws-lead', ?, 'منى', '01012349901', 'فيسبوك', 'new', 0, NOW())`, [TENANT]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, is_active, created_at)
     VALUES ('ws-client', ?, 'هالة', '01012349902', 1, NOW())`, [TENANT]);
  const channel = await channels.createChannel({
    tenantId: TENANT, kind: 'whatsapp', provider: 'meta', label: 'رقم الشركة',
    credentials: { metaPhoneId: 'PHONE-ID-WS', metaToken: 'token' }, makeDefault: true,
  });
  await channels.markChannelConnected(TENANT, channel.id);
  channelId = channel.id;
  global.fetch = async (url, options = {}) => {
    sent.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.WS${sent.length}` }] }) };
  };
});
after(async () => { if (ENABLED) { global.fetch = realFetch; await clean(); await pool.end(); } });

test('«ستوب» records the opt-out on the lead and is answered once', { skip }, async () => {
  const result = await say(LEAD_PHONE, 'ستوب');
  assert.equal(result.optedOut, true);
  assert.equal(result.consentReplied, true);
  assert.equal(await consent.isSuppressed(TENANT, 'whatsapp', LEAD_PHONE), true);
  assert.equal(await consent.isSuppressed(TENANT, 'whatsapp', '01012349901'), true, 'whatever the spelling');
  const [[audit]] = await pool.query(
    "SELECT subject_type, subject_id, action, source FROM marketing_consent_audit WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1", [TENANT]);
  assert.deepEqual({ ...audit }, { subject_type: 'lead', subject_id: 'ws-lead', action: 'unsubscribed', source: 'whatsapp_reply' });
  assert.deepEqual(textsTo(LEAD_PHONE), [inbound.OPT_OUT_REPLY]);
  assert.match(inbound.OPT_OUT_REPLY, /ابدأ/);
  assert.match(inbound.OPT_OUT_REPLY, /START/);
  const [[logged]] = await pool.query(
    "SELECT notes FROM communications WHERE tenant_id=? AND lead_id='ws-lead' AND direction='OUT'", [TENANT]);
  assert.equal(logged.notes, inbound.OPT_OUT_REPLY, 'the rep sees what they were told');

  // Again, spelt differently: already off, so no second answer.
  const again = await say(LEAD_PHONE, 'STOP.');
  assert.equal(again.optedOut, true);
  assert.equal(again.consentReplied, false);
  assert.equal(textsTo(LEAD_PHONE).length, 1);
});

test('a promotion to that number is refused when sent; a receipt still goes', { skip }, async () => {
  const before = sent.length;
  for (const category of ['marketing', 'broadcast', 'automation']) {
    const result = await whatsapp.sendWhatsApp(LEAD_PHONE, 'عرض خاص', { tenantId: TENANT, category });
    assert.equal(result.reason, 'opted_out', category);
  }
  assert.equal(sent.length, before, 'nothing reached Meta');
  const receipt = await whatsapp.sendWhatsApp(LEAD_PHONE, '✅ تم استلام دفعتك', { tenantId: TENANT, category: 'payment' });
  assert.equal(receipt.ok, true);
  const code = await whatsapp.sendWhatsApp(LEAD_PHONE, 'رمز الدخول: 1234', { tenantId: TENANT, category: 'otp' });
  assert.equal(code.ok, true);
  const campaigns = require('../../lib/whatsappCampaigns');
  const audience = await campaigns.buildAudience({ tenantId: TENANT, audience: 'leads' });
  assert.equal(audience.recipients.length, 0, 'and a campaign audience leaves them out');
});

test('«ابدأ» takes them back, answered once', { skip }, async () => {
  const result = await say(LEAD_PHONE, 'ابدأ');
  assert.equal(result.optedIn, true);
  assert.equal(result.consentReplied, true);
  assert.equal(await consent.isSuppressed(TENANT, 'whatsapp', LEAD_PHONE), false);
  assert.equal(textsTo(LEAD_PHONE).at(-1), inbound.OPT_IN_REPLY);
  const promo = await whatsapp.sendWhatsApp(LEAD_PHONE, 'عرض خاص', { tenantId: TENANT, category: 'marketing' });
  assert.equal(promo.ok, true);

  const count = textsTo(LEAD_PHONE).length;
  const again = await say(LEAD_PHONE, 'START');
  assert.equal(again.optedIn, false, 'nothing to undo');
  assert.equal(textsTo(LEAD_PHONE).length, count);
});

test('a client is matched as a client, and «ابدأ» from someone who never stopped is just a message', { skip }, async () => {
  const start = await say(CLIENT_PHONE, 'ابدا');
  assert.equal(start.optedIn, false);
  assert.equal(start.senderKind, 'subscriber');
  assert.equal(textsTo(CLIENT_PHONE).length, 0);
  const stop = await say(CLIENT_PHONE, 'إلغاء');
  assert.equal(stop.optedOut, true);
  const [[row]] = await pool.query(
    "SELECT subject_type, subject_id FROM marketing_suppressions WHERE tenant_id=? AND subject_id='ws-client'", [TENANT]);
  assert.equal(row.subject_type, 'subscriber');
  assert.equal(inbound.isOptOut('عايزة ألغي الحجز'), false, 'a question is not an unsubscribe');
  assert.equal(inbound.isOptOut('وقف'), true);
});
