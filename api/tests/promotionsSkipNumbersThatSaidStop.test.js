'use strict';

// «ابعت STOP أو ستوب يوقف الرسايل» (11 Oct 2026): every promotional kind is
// checked against the opt-out list at the moment it is sent (lib/whatsapp.js),
// while codes, receipts and staff alerts are never held by it. And a queued
// message can go as an approved Meta template — the one it carries, or the one
// the owner set for its kind — falling back to its text on any other provider.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WHATSAPP_OUTBOUND_CATEGORIES = 'all';
const settings = new Map();
const suppressedNumbers = new Set(['201011111111']);
let consentDown = false;
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/tenantSettings', {
  getTenantSetting: async (key, { tenantId, fallback } = {}) => settings.get(`${tenantId}:${key}`) ?? fallback,
});
stub('../lib/messagingChannels', { getSendableChannel: async () => null });
stub('../lib/marketingConsent', {
  isSuppressed: async (_tenantId, channel, phone) => {
    assert.equal(channel, 'whatsapp');
    if (consentDown) throw new Error('db down');
    return suppressedNumbers.has(phone);
  },
});

const calls = [];
global.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), body: options.body });
  return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }], idMessage: 'green-1' }) };
};
const whatsapp = require('../lib/whatsapp');

settings.set('t-meta:whatsapp_config', { provider: 'meta', metaToken: 'token', metaPhoneId: 'PHONE' });
settings.set('t-green:whatsapp_config', { provider: 'green-api', instanceId: '1101', apiToken: 'secret' });

test('a promotion to a number that wrote «ستوب» is refused before the provider is touched', async () => {
  for (const category of ['marketing', 'broadcast', 'automation']) {
    calls.length = 0;
    const result = await whatsapp.sendWhatsApp('01011111111', 'عرض', { tenantId: 't-meta', category });
    assert.equal(result.reason, 'opted_out', category);
    assert.equal(calls.length, 0, `${category}: nothing reached Meta`);
  }
  calls.length = 0;
  assert.equal((await whatsapp.sendWhatsAppTemplate('01011111111', { name: 'promo' }, { tenantId: 't-meta', category: 'broadcast' })).reason, 'opted_out');
  assert.equal(calls.length, 0);
});

test('codes, receipts, reminders and staff alerts still reach the same number', async () => {
  for (const category of ['otp', 'payment', 'reminder', 'staff_alert', 'owner_report', 'inbox_reply']) {
    calls.length = 0;
    const result = await whatsapp.sendWhatsApp('01011111111', 'إيصال', { tenantId: 't-meta', category });
    assert.equal(result.ok, true, category);
    assert.equal(calls.length, 1);
  }
});

test('a promotion is never sent on a list nobody could read', async () => {
  consentDown = true;
  calls.length = 0;
  const result = await whatsapp.sendWhatsApp('01022222222', 'عرض', { tenantId: 't-meta', category: 'marketing' });
  consentDown = false;
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
  assert.match(whatsapp.describeReason('opted_out'), /ستوب/);
});

test('the outbox can carry a template in Meta\'s own shape', async () => {
  calls.length = 0;
  const components = [{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://x.test/a.png' } }] }];
  const result = await whatsapp.sendQueuedWhatsApp('01022222222', {
    message: 'نص بديل', template: { name: 'course_offer', language: 'ar', components }, tenantId: 't-meta', category: 'reminder',
  });
  assert.equal(result.ok, true);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.type, 'template');
  assert.deepEqual(body.template, { name: 'course_offer', language: { code: 'ar' }, components });
});

test('a template goes as its text from a number that is not on Meta', async () => {
  calls.length = 0;
  const result = await whatsapp.sendQueuedWhatsApp('01022222222', {
    message: 'نص بديل', template: { name: 'course_offer', language: 'ar', params: ['x'] }, tenantId: 't-green', category: 'reminder',
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /green-api/);
  assert.equal(JSON.parse(calls[0].body).message, 'نص بديل');
  // With no text beside it there is nothing to fall back to.
  const bare = await whatsapp.sendQueuedWhatsApp('01022222222', { template: { name: 'x' }, tenantId: 't-green', category: 'reminder' });
  assert.equal(bare.reason, 'templates_need_meta');
});

test('the approved template set for a kind carries the queued text as {{1}}', async () => {
  assert.deepEqual(await whatsapp.categoryTemplates('t-meta'), {}, 'empty until the owner fills it in');
  settings.set('t-meta:whatsapp_templates', { categories: {
    reminder: { name: 'session_reminder', language: 'ar_EG' }, bogus_kind: 'x', payment: 'Bad Name!',
  } });
  whatsapp.invalidateOutbound('t-meta');
  assert.deepEqual(await whatsapp.categoryTemplates('t-meta'), { reminder: { name: 'session_reminder', language: 'ar_EG' } });
  calls.length = 0;
  await whatsapp.sendQueuedWhatsApp('01022222222', { message: 'بكرة الجلسة\n\nالساعة 7', tenantId: 't-meta', category: 'reminder' });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.template.name, 'session_reminder');
  assert.deepEqual(body.template.components, [{ type: 'body', parameters: [{ type: 'text', text: 'بكرة الجلسة · الساعة 7' }] }],
    'Meta refuses a parameter with a new line in it');
  // A kind with none set goes as text.
  calls.length = 0;
  await whatsapp.sendQueuedWhatsApp('01022222222', { message: 'إيصال', tenantId: 't-meta', category: 'payment' });
  assert.equal(JSON.parse(calls[0].body).type, 'text');
  // The panel shows the map and the kinds it can hold.
  const state = await whatsapp.outboundState('t-meta');
  assert.deepEqual(state.templates, { reminder: { name: 'session_reminder', language: 'ar_EG' } });
  assert.ok(state.templateKinds.includes('marketing'));
});

test('marketing has its own switch, closed until the owner opens it', async () => {
  process.env.WHATSAPP_OUTBOUND_CATEGORIES = 'otp';
  delete require.cache[require.resolve('../lib/whatsapp')];
  const gated = require('../lib/whatsapp');
  assert.equal(await gated.isCategoryOpen('marketing', 't-closed'), false);
  assert.ok((await gated.outboundState('t-closed')).switchable.includes('marketing'));
  settings.set('t-open:whatsapp_outbound', { categories: ['marketing'] });
  assert.equal(await gated.isCategoryOpen('marketing', 't-open'), true);
  process.env.WHATSAPP_OUTBOUND_CATEGORIES = 'all';
});
