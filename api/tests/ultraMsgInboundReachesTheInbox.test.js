'use strict';

// 31 Oct 2026: «ليه لحد دلوقتي رسايل الماسنجر والواتس اب مش موجودة في صندوق البريد المجمع». The institute's own WhatsApp number is on UltraMsg
// (lib/whatsapp.js, commit b192f057) and the only inbound webhooks were Meta's and Green API's: a customer's message to that number stopped at
// the provider and never reached the system. It is read now, through the same recordInboundMessage that files it on the timeline, opens the
// conversation in the team inbox and creates the lead.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-ultramsg-secret-0123456789-abcdefghijklmnopqr';
const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const { extractUltraMsgMessage } = require('../lib/whatsappInbound');

const callback = data => ({ event_type: 'message_received', instanceId: '5000', data });

test('a customer\'s message becomes the message the inbox files; a picture or a voice note still says one came', () => {
  assert.deepEqual(extractUltraMsgMessage(callback({
    id: 'false_201012345678@c.us_ABC', from: '201012345678@c.us', to: '201000000000@c.us', type: 'chat', body: 'عايز اعرف عن الدبلومة', fromMe: false, time: 1793400000,
  })), { providerMessageId: 'false_201012345678@c.us_ABC', from: '201012345678', body: 'عايز اعرف عن الدبلومة', timestamp: 1793400000 });
  assert.equal(extractUltraMsgMessage(callback({ id: 'a', from: '201012345678@c.us', type: 'ptt', fromMe: false })).body, '🎤 رسالة صوتية');
  assert.equal(extractUltraMsgMessage(callback({ id: 'b', from: '201012345678@c.us', type: 'image', fromMe: false })).body, '📷 صورة');
  assert.equal(extractUltraMsgMessage(callback({ id: 'c', from: '201012345678@c.us', type: 'vcard', fromMe: false })).body, '👤 جهة اتصال');
});

test('what the number itself sent, a group, and any callback that is not a received message are nobody\'s inbound', () => {
  assert.equal(extractUltraMsgMessage(callback({ id: 'd', from: '201012345678@c.us', body: 'رد', fromMe: true })), null);
  assert.equal(extractUltraMsgMessage(callback({ id: 'e', from: '201012345678@c.us', body: 'x', fromMe: false, self: true })), null);
  assert.equal(extractUltraMsgMessage(callback({ id: 'f', from: '12036302-1699@g.us', body: 'hi', fromMe: false })), null);
  assert.equal(extractUltraMsgMessage({ event_type: 'message_ack', data: { id: 'g' } }), null);
  assert.equal(extractUltraMsgMessage({ event_type: 'message_create', data: { id: 'h', fromMe: true } }), null);
  assert.equal(extractUltraMsgMessage(undefined), null);
});

test('the UltraMsg address is public, limited, and answers nothing without the secret it was given', () => {
  const route = read('api/routes/whatsapp-webhook.js');
  assert.match(route, /router\.post\('\/api\/webhooks\/whatsapp\/ultramsg', whatsappWebhookLimiter,/);
  assert.match(route, /resolveSecret\('WHATSAPP_ULTRAMSG_WEBHOOK_SECRET'\)/);
  assert.match(route, /if \(!webhookSecret\) return res\.status\(503\)/, 'unconfigured is refused, never open');
  assert.match(route, /safeEqual\(req\.headers\['x-webhook-token'\] \|\| req\.query\.token, webhookSecret\)/);
  assert.match(route, /configuredInstance !== received\) \{\s+return res\.status\(401\)/, 'another instance\'s callbacks are not ours');
  assert.match(route, /extractUltraMsgMessage\(req\.body\);\s+const result = message \? await recordInboundMessage\(\{ tenantId: req\.tenantId, \.\.\.message \}\)/);
});

test('whoever sees every conversation lands on «الكل», not on an empty «محادثاتي»', () => {
  const screen = read('admin/pages/dashboard/tabs/whatsapp/TeamInboxTab.tsx');
  assert.match(screen, /const pickedView = useRef\(false\);/);
  assert.match(screen, /if \(list\.seesAll && !pickedView\.current\) \{ pickedView\.current = true; setViewState\('all'\); \}/);
  assert.match(screen, /const setView = useCallback\(\(next: View\) => \{ pickedView\.current = true; setViewState\(next\); \}, \[\]\);/);
});
