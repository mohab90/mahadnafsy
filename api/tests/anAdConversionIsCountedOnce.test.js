'use strict';

// «تتبّع الإعلانات صح» (11 Oct 2026): Lead and Purchase reach Meta from the
// server as well as the browser, under one event id so the pair counts once,
// hashed as Meta asks, never when unconfigured or refused, and never in the way
// of the request that caused them.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-meta-capi-secret-0123456789-abcdefghijklmnop';

let settingsRow = null;
const query = async (sql) => {
  if (/FROM tenant_settings/.test(sql)) return [[settingsRow].filter(Boolean)];
  return [[]];
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query, execute: query }, cached: async (_k, _t, fn) => fn(), cacheInvalidate() {},
  requireDb: (_q, _s, n) => n(), isDbDown: () => false,
});

const metaCapi = require('../lib/metaCapi');
const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

const calls = [];
let answer = async () => ({ ok: true, status: 200, json: async () => ({}) });
globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return answer(); };

function configure({ token = '', settings = null } = {}) {
  metaCapi._test.configCache.clear();
  calls.length = 0;
  settingsRow = settings ? { config_json: JSON.stringify(settings) } : null;
  if (token) process.env.META_CAPI_TOKEN = token; else delete process.env.META_CAPI_TOKEN;
}

const request = (headers = {}) => ({
  tenantId: 'tenant-default',
  ip: '41.33.12.7',
  headers: {
    'user-agent': 'Mozilla/5.0 test',
    cookie: '_fbp=fb.1.1760000000000.123456789; other=1',
    referer: 'https://mahadnafsy.com/c/cbt?fbclid=AbC_123-x',
    'x-event-id': 'lead-evt-0001',
    ...headers,
  },
});

test('email and number are normalised the way Meta matches them, then hashed', () => {
  const event = metaCapi.buildEvent({
    eventName: 'Lead', eventId: 'e-123456', context: {},
    user: { email: '  Mona@Example.COM ', phone: '0101 234 5678', name: 'منى  أحمد' },
  });
  assert.deepEqual(event.user_data.em, [sha('mona@example.com')]);
  assert.deepEqual(event.user_data.ph, [sha('201012345678')], 'country code, no trunk zero, digits only');
  assert.deepEqual(event.user_data.fn, [sha('منى')]);
  assert.deepEqual(event.user_data.ln, [sha('أحمد')]);
  assert.equal(JSON.stringify(event).includes('mona@'), false, 'nothing in the clear');
});

test('a lead carries the browser\'s event id, address, browser, fbp and the click', () => {
  const context = metaCapi.adContextFromRequest(request());
  assert.equal(context.eventId, 'lead-evt-0001');
  assert.equal(context.ip, '41.33.12.7');
  assert.equal(context.fbp, 'fb.1.1760000000000.123456789');
  assert.match(context.fbc, /^fb\.1\.\d+\.AbC_123-x$/, 'built from the landing page\'s fbclid when the pixel left no _fbc');
  assert.equal(context.url, 'https://mahadnafsy.com/c/cbt?fbclid=AbC_123-x');
  assert.equal(metaCapi.adContextFromRequest(request({ 'x-event-id': 'bad id <script>' })).eventId, '');
});

test('unconfigured, nothing is sent', async () => {
  configure();
  const result = await metaCapi.trackLead(request(), { name: 'منى', phone: '01012345678' });
  assert.equal(result.sent, false);
  assert.equal(calls.length, 0);
});

test('with the token, the site\'s own pixel gets the Lead', async () => {
  configure({ token: 'env-token-xyz' });
  const result = await metaCapi.trackLead(request(), { name: 'منى', phone: '01012345678', leadId: 'lead-1' });
  assert.equal(result.sent, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /graph\.facebook\.com\/v\d+\.\d+\/1879086466096343\/events\?access_token=env-token-xyz$/);
  const [event] = calls[0].body.data;
  assert.equal(event.event_name, 'Lead');
  assert.equal(event.event_id, 'lead-evt-0001');
  assert.equal(event.action_source, 'website');
  assert.equal(event.user_data.client_user_agent, 'Mozilla/5.0 test');
});

test('an institute\'s own setting wins, and another institute never borrows this pixel', async () => {
  configure({ token: 'env-token-xyz', settings: { metaCapi: { pixelId: '555000111', accessToken: 'own-token', testEventCode: 'TEST42' } } });
  await metaCapi.trackLead(request(), { phone: '01012345678' });
  assert.match(calls[0].url, /\/555000111\/events\?access_token=own-token$/);
  assert.equal(calls[0].body.test_event_code, 'TEST42');

  configure({ token: 'env-token-xyz' });
  const other = await metaCapi.trackLead({ ...request(), tenantId: 'tenant-other' }, { phone: '01012345678' });
  assert.equal(other.sent, false);
  assert.equal(calls.length, 0);
});

test('a browser that refuses is respected', async () => {
  configure({ token: 'env-token-xyz' });
  assert.equal((await metaCapi.trackLead(request({ 'sec-gpc': '1' }), { phone: '01012345678' })).reason, 'consent');
  assert.equal((await metaCapi.trackLead(request({ 'x-ad-consent': 'denied' }), { phone: '01012345678' })).reason, 'consent');
  assert.equal((await metaCapi.trackPurchase({ order: { id: 'o-1', amount: 900 }, adContext: { consent: false } })).reason, 'consent');
  assert.equal(calls.length, 0);
});

test('a failure or a hang is logged, never thrown', async () => {
  configure({ token: 'env-token-xyz' });
  answer = async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); };
  assert.deepEqual(await metaCapi.trackLead(request(), { phone: '01012345678' }), { sent: false, reason: 'error' });
  answer = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid parameter' } }) });
  assert.equal((await metaCapi.trackLead(request(), { phone: '01012345678' })).status, 400);
  answer = async () => ({ ok: true, status: 200, json: async () => ({}) });
  assert.match(read('api/lib/metaCapi.js'), /signal: AbortSignal\.timeout\(TIMEOUT_MS\)/);
});

test('a purchase is the order\'s, in its own price and currency, under the id /success uses', async () => {
  configure({ token: 'env-token-xyz' });
  await metaCapi.trackPurchase({
    tenantId: 'tenant-default',
    order: { id: 'ord-9', amount: '1500.00', currency: 'SAR', item_id: 'c-1', item_title: 'العلاج المعرفي', customer_email: 'a@b.co' },
    adContext: { ip: '41.1.1.1', ua: 'UA', fbp: 'fb.1.1760000000000.1', url: 'https://mahadnafsy.com/checkout' },
  });
  const [event] = calls[0].body.data;
  assert.equal(event.event_name, 'Purchase');
  assert.equal(event.event_id, 'purchase-ord-9');
  assert.equal(event.custom_data.value, 1500);
  assert.equal(event.custom_data.currency, 'SAR');
  assert.deepEqual(event.custom_data.content_ids, ['c-1']);
  assert.equal(event.user_data.client_ip_address, '41.1.1.1');
  // The browser fires its copy with the same id.
  assert.match(read('client/lib/tracking.ts'), /export const purchaseEventId = \(orderId: string\): string => `purchase-\$\{orderId\}`;/);
});

test('the pixel is the one the site loads', () => {
  const html = read('client/index.html');
  assert.ok(html.includes(`fbq('init', '${metaCapi.SITE_PIXEL_ID}')`));
  assert.doesNotMatch(html, /fbq\('track', 'PageView'\)/, 'the page view is the router\'s now, or the landing page counts twice');
  assert.match(html, /send_page_view: false/);
});

test('every lead route and the paid order send theirs, without waiting on Meta', () => {
  const leads = read('api/routes/lead-capture-crm.js');
  assert.equal(leads.split('void metaCapi.trackLead(req,').length - 1, 2, '/api/registrations and /api/leads-public');
  assert.match(leads, /adContext: metaCapi\.adContextFromRequest\(req\)/, 'the checkout keeps the click for the purchase');
  assert.match(read('api/routes/public.js'), /void metaCapi\.trackLead\(req, \{ name, email, phone, leadId: id/);
  assert.match(read('api/routes/public-orders.js'), /adContext: adContextFromRequest\(req\)/);
  const paid = read('api/lib/paymobFinalise.js');
  assert.match(paid, /void trackPurchase\(\{ tenantId, order, adContext: extra\?\.adContext \}\);/);
  assert.ok(paid.indexOf('void trackPurchase(') > paid.indexOf('await conn.commit();'), 'only once the payment is committed');
  const forms = read('client/lib/mysqlapi.ts');
  for (const route of ['/contact', '/registrations', '/leads-public']) {
    assert.match(forms, new RegExp(`'${route}', \\{ method: 'POST', body: JSON\\.stringify\\(data\\), headers: leadHeaders\\(\\) \\}`), route);
  }
});
