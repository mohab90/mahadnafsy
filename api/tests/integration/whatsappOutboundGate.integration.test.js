'use strict';
/**
 * The WhatsApp outbound gate, on a real MariaDB with the default allowlist (these were regular expressions over lib/whatsapp.js — `WHATSAPP_OUTBOUND_CATEGORIES ?? 'otp'`,
 * `isCategoryAllowed`, `isCategoryOpen`, `reason: 'category_disabled'`; the ones in tests/whatsappOutboundGate.test.js that read the call sites stay): out of the box only
 * verification codes leave, a send that names no category or an unknown one is refused before anything else, the owner's own reports and staff alerts always leave, the
 * panel's switch opens one kind for that institute only, a promotion to someone who wrote «ستوب» is refused whatever the switch says, and a blocked send is described as a
 * deliberate refusal, not a broken channel. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
delete process.env.WHATSAPP_OUTBOUND_CATEGORIES; // the default: codes only
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-wagate-it'; const OTHER = 'tenant-wagate-other';
const PHONE = '01019977001';
let pool; let wa; let consent;

const send = (category, tenantId = T) => wa.sendWhatsApp(PHONE, 'مرحبا', { tenantId, category });

async function clean() {
  for (const tenant of [T, OTHER]) {
    for (const table of ['marketing_consent_audit', 'marketing_suppressions', 'subscribers', 'tenant_settings']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [tenant]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  wa = require('../../lib/whatsapp');
  consent = require('../../lib/marketingConsent');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active'), (?, ?, 'IT2', 'active')", [T, T, OTHER, OTHER]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES ('sub-wg-1', ?, 'عميلة', '1019977001', 'ONLINE_EGYPT', 'branch-online-egypt')", [T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('out of the box only codes leave: no category, an unknown one or a promotion is refused first; the owner\'s reports and staff alerts always leave', { skip }, async () => {
  for (const category of [undefined, '', 'promotion', 'welcome', 'broadcast', 'surprise']) {
    const result = await send(category);
    assert.deepEqual([result.ok, result.reason], [false, 'category_disabled'], `category ${JSON.stringify(category)}`);
  }
  for (const category of ['otp', 'owner_report', 'staff_alert']) {
    const result = await send(category);
    assert.notEqual(result.reason, 'category_disabled', `${category} is past the gate (it then fails for want of a provider, not for its kind)`);
  }
  const template = await wa.sendWhatsAppTemplate(PHONE, { name: 'promo', language: 'ar', params: [] }, { tenantId: T, category: 'marketing' });
  assert.equal(template.reason, 'category_disabled', 'a template goes through the same gate');
});

test('the panel opens a kind for that institute only; «ستوب» still stops a promotion; a refusal is described as a refusal', { skip }, async () => {
  const { setTenantSetting } = require('../../lib/tenantSettings');
  await setTenantSetting('whatsapp_outbound', { categories: ['welcome', 'marketing', 'not_a_kind'] }, { tenantId: T });
  wa.invalidateOutbound(T);
  assert.notEqual((await send('welcome')).reason, 'category_disabled', 'switched on in the panel');
  assert.equal((await send('welcome', OTHER)).reason, 'category_disabled', 'another institute is still shut');
  assert.equal((await send('not_a_kind')).reason, 'category_disabled', 'a name the panel does not offer cannot be switched on');
  assert.equal((await send('payment')).reason, 'category_disabled', 'and the others stay shut');

  assert.notEqual((await send('marketing')).reason, 'opted_out', 'a promotion goes while nobody stopped it');
  await consent.setMarketingConsent({ tenantId: T, subjectType: 'subscriber', subjectId: 'sub-wg-1', channel: 'whatsapp', subscribed: false, source: 'stop-reply' });
  assert.equal((await send('marketing')).reason, 'opted_out', 'the man who wrote «ستوب» is not sent a promotion');
  assert.notEqual((await send('welcome')).reason, 'opted_out', 'but a welcome is not a promotion');

  assert.match(wa.describeReason('category_disabled'), /موقوف/);
  assert.equal(wa.isTransientSendFailure('category_disabled'), false, 'a deliberate refusal is not a channel to retry or to mark broken');
  const state = await wa.outboundState(T);
  assert.deepEqual([...state.panel].sort(), ['marketing', 'welcome']);
});
