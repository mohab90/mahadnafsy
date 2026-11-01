'use strict';

const { checkoutSource } = require('./_authRouteSource');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { preserveStoredSecrets, redactSecrets } = require('../lib/configSecrets');
const { isPaymobActive } = require('../lib/saasSettings');

test('system config responses redact nested and list secrets', () => {
  const redacted = redactSecrets({
    paymob: { api_key: 'key', merchant_id: 'merchant' },
    api_sources: [{ id: 'a', secret: 'source-secret', name: 'source' }],
  });
  assert.deepEqual(redacted, {
    paymob: { api_key: '', merchant_id: 'merchant' },
    api_sources: [{ id: 'a', secret: '', name: 'source' }],
  });
});

test('blank secret fields preserve stored values by object key and list id', () => {
  const stored = {
    paymob: { api_key: 'old-key', merchant_id: 'old-merchant' },
    api_sources: [{ id: 'a', secret: 'old-secret', name: 'old' }],
  };
  const incoming = {
    paymob: { api_key: '', merchant_id: 'new-merchant' },
    api_sources: [{ id: 'a', secret: '', name: 'new' }],
  };
  assert.deepEqual(preserveStoredSecrets(stored, incoming), {
    paymob: { api_key: 'old-key', merchant_id: 'new-merchant' },
    api_sources: [{ id: 'a', secret: 'old-secret', name: 'new' }],
  });
});

test('Paymob remains fail-closed while provider review is pending', () => {
  const previous = process.env.PAYMOB_REVIEW_PENDING;
  try {
    process.env.PAYMOB_REVIEW_PENDING = 'true';
    assert.equal(isPaymobActive({ active_provider: 'paymob', paymob: { enabled: true } }), false);
    process.env.PAYMOB_REVIEW_PENDING = 'false';
    assert.equal(isPaymobActive({ active_provider: 'paymob', paymob: { enabled: true } }), true);
  } finally {
    if (previous === undefined) delete process.env.PAYMOB_REVIEW_PENDING;
    else process.env.PAYMOB_REVIEW_PENDING = previous;
  }
});

test('legacy Paymob order reservation fails before any database mutation while disabled', () => {
  const route = checkoutSource();
  const reserve = route.slice(route.indexOf("router.post('/api/orders/reserve'"));
  assert.ok(reserve.indexOf('if (!isPaymobActive(config))') < reserve.indexOf('await pool.getConnection()'));
});

// «لما بحفظ وارجع أعمل تعديل كل حاجة بتختفي» (28 Oct 2026): the settings read blanked every token — and the webhook verify token the
// admin has to paste into Meta's form — so a saved configuration looked lost. The value was never lost (a blank is preserved on save);
// the form just could not say so.
const { SAVED_HINTS } = require('../lib/configSecrets');

test('without options redaction is unchanged: every secret blank, no hints', () => {
  const out = redactSecrets({ whatsapp: { phoneNumberId: '123', accessToken: 'EAAGtokenvalue1234', webhookVerifyToken: 'hook-token' } });
  assert.deepEqual(out, { whatsapp: { phoneNumberId: '123', accessToken: '', webhookVerifyToken: '' } });
});

test('the settings read blanks the secrets, says which are saved, and gives the verify token back', () => {
  const out = redactSecrets({
    messagingChannels: {
      whatsapp: { phoneNumberId: '109876', accessToken: 'EAAGtokenvalue1234', webhookVerifyToken: 'mahad-hook-9' },
      messenger: { pageId: '5544', pageAccessToken: 'EAAGpagetoken5678', appSecret: 'abcdef0123456789', webhookVerifyToken: '' },
    },
    adminAiConfig: { provider: 'gemini', apiKey: 'AIzaSyKeyKeyKey4321', model: 'gemini-2.5-flash' },
  }, { hints: true, keepVerifyTokens: true });
  assert.deepEqual(out.messagingChannels.whatsapp, { phoneNumberId: '109876', accessToken: '', webhookVerifyToken: 'mahad-hook-9', [SAVED_HINTS]: { accessToken: '1234' } });
  assert.deepEqual(out.messagingChannels.messenger, { pageId: '5544', pageAccessToken: '', appSecret: '', webhookVerifyToken: '', [SAVED_HINTS]: { pageAccessToken: '5678', appSecret: true } });
  assert.deepEqual(out.adminAiConfig, { provider: 'gemini', apiKey: '', model: 'gemini-2.5-flash', [SAVED_HINTS]: { apiKey: '4321' } });
  const text = JSON.stringify(out);
  for (const secret of ['EAAGtokenvalue1234', 'EAAGpagetoken5678', 'abcdef0123456789', 'AIzaSyKeyKeyKey4321']) assert.ok(!text.includes(secret), secret);
  assert.ok(!text.includes('0123456789'.slice(0, 0) + 'abcdef0123'), 'not even the start of an app secret');
});

test('a short value shows only that something is saved, and an empty one shows nothing', () => {
  const out = redactSecrets({ x: { accessToken: 'abc', apiKey: '', password: 'hunter2hunter2' } }, { hints: true });
  assert.deepEqual(out.x, { accessToken: '', apiKey: '', password: '', [SAVED_HINTS]: { accessToken: true, password: true } });
});

test('what the form sends back never stores the hints, and a blank still keeps the saved value', () => {
  const stored = { messagingChannels: { whatsapp: { phoneNumberId: '1098', accessToken: 'REAL-TOKEN', webhookVerifyToken: 'hook' } } };
  const echoed = {
    messagingChannels: { whatsapp: { phoneNumberId: '2222', accessToken: '', webhookVerifyToken: 'hook', [SAVED_HINTS]: { accessToken: 'KEN' } }, [SAVED_HINTS]: { x: true } },
  };
  const saved = preserveStoredSecrets(stored, echoed);
  assert.deepEqual(saved, { messagingChannels: { whatsapp: { phoneNumberId: '2222', accessToken: 'REAL-TOKEN', webhookVerifyToken: 'hook' } } });
  assert.ok(!JSON.stringify(saved).includes('__savedSecrets'));
  // a new token replaces the old one
  assert.equal(preserveStoredSecrets(stored, { messagingChannels: { whatsapp: { accessToken: 'NEW-TOKEN' } } }).messagingChannels.whatsapp.accessToken, 'NEW-TOKEN');
});

test('a read, a save of the same form, and a second read keep the token and the identifiers', () => {
  let stored = { messagingChannels: { whatsapp: { phoneNumberId: '1098', whatsappBusinessAccountId: '3344', accessToken: 'EAAGtokenvalue1234', webhookVerifyToken: 'hook' } } };
  const read = () => redactSecrets(stored, { hints: true, keepVerifyTokens: true });
  const first = read();
  stored = { ...stored, ...preserveStoredSecrets(stored, first) };
  const second = read();
  assert.deepEqual(second, first);
  assert.equal(stored.messagingChannels.whatsapp.accessToken, 'EAAGtokenvalue1234');
  assert.equal(second.messagingChannels.whatsapp.phoneNumberId, '1098');
});

test('only the admin settings read asks for hints; the settings forms show them', () => {
  const root = path.join(__dirname, '..', '..');
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  assert.match(read('api/routes/config.js'), /redactSecrets\(await getTenantSetting\('settings', \{ tenantId: req\.tenantId, fallback: \{\} \}\), \{ hints: true, keepVerifyTokens: true \}\)/);
  // The system sections (Paymob, the SMS provider, the lead sources) ask too since 1 Nov 2026: their keys never came back, so after a save every
  // key box was empty and looked lost. What the screen sends back with the hints is stripped before it is validated or stored.
  const system = read('api/routes/misc/admincfg.js');
  assert.match(system, /redactSecrets\(saved \?\? SYS_DEFAULTS\[section\] \?\? null, \{ hints: true, keepVerifyTokens: true \}\)/);
  assert.match(system, /const body = stripSavedHints\(req\.body\);/);
  for (const [tab, key] of [['PaymentSettingsTab', 'api_key'], ['PaymentSettingsTab', 'hmac_secret'], ['LeadSourcesSettingsTab', 'page_access_token'], ['OtpSettingsTab', 'api_secret']]) {
    const source = read(`admin/pages/dashboard/tabs/${tab}.tsx`);
    assert.ok(source.includes(`savedSecretPlaceholder(`) && source.includes(`'${key}'`), `${tab} ${key}`);
    assert.ok(source.includes('await load();'), `${tab} reads back after a save`);
  }
  const messaging = read('admin/pages/dashboard/tabs/MessagingAgentTab.tsx');
  for (const section of ['whatsapp', 'messenger', 'instagram']) {
    assert.ok(messaging.includes(`savedSecretPlaceholder(chDraft.${section}.__savedSecrets, f.key, f.ph)`), section);
  }
  assert.ok(messaging.includes("savedSecretPlaceholder(agentDraft.__savedSecrets, 'apiKey',"));
  assert.ok(read('admin/pages/dashboard/tabs/AdminAiSettingsTab.tsx').includes("savedSecretPlaceholder(adminAiConfig?.__savedSecrets, 'apiKey',"));
  const helper = read('admin/lib/savedSecrets.ts');
  assert.match(helper, /محفوظ\$\{typeof hint === 'string' \? ` \(••••\$\{hint\}\)` : ''\} — سيبه فاضي لو مش هتغيّره/);
  for (const name of ['WhatsAppChannelConfig', 'MessengerChannelConfig', 'InstagramChannelConfig', 'AiAgentConfig', 'AdminAiConfig']) {
    const types = read('admin/types.ts');
    const start = types.indexOf(`export interface ${name} {`);
    assert.ok(start >= 0 && types.slice(start, start + 400).includes('__savedSecrets?: Record<string, string | true>;'), name);
  }
});

test('a new row never inherits the secret of the row at its position, and a screen\'s hints are not data', () => {
  const { preserveStoredSecrets, stripSavedHints } = require('../lib/configSecrets');
  const stored = [{ id: 'a', secret: 'SECRET-A' }, { id: 'b', secret: 'SECRET-B' }];
  // Row «a» is deleted, a new row is added, «b» is kept blank: b keeps its own secret, the new one has none.
  const saved = preserveStoredSecrets(stored, [{ id: 'b', secret: '' }, { id: 'new', secret: '' }]);
  assert.equal(saved[0].secret, 'SECRET-B');
  assert.equal(saved[1].secret, '', 'not SECRET-B, which sat at index 1');
  assert.deepEqual(stripSavedHints({ paymob: { api_key: '', __savedSecrets: { api_key: 'W999' } }, list: [{ __savedSecrets: { secret: true }, x: 1 }] }),
    { paymob: { api_key: '' }, list: [{ x: 1 }] });
});
