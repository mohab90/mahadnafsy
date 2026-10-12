'use strict';

// «تتبّع إعلانات ميتا» in Admin → التكاملات (12 Oct 2026): the Conversions API
// config could only be set from the server's environment or by hand in the
// settings blob, with no way to see which was in effect or whether Meta took
// anything. The screen reads where each part comes from, saves through
// PUT /api/admin/settings, and sends one test Lead — and no answer it gets
// ever carries the token.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-meta-capi-screen-secret-0123456789-abcdefgh';

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

const calls = [];
let answer = async () => ({ ok: true, status: 200, json: async () => ({ events_received: 1 }) });
globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return answer(); };

const TENANT = 'tenant-default';
function configure({ token = '', pixel = '', code = '', settings = null } = {}) {
  metaCapi.invalidateConfig(TENANT);
  calls.length = 0;
  settingsRow = settings ? { config_json: JSON.stringify(settings) } : null;
  for (const [name, value] of [['META_CAPI_TOKEN', token], ['META_PIXEL_ID', pixel], ['META_CAPI_TEST_EVENT_CODE', code]]) {
    if (value) process.env[name] = value; else delete process.env[name];
  }
}

test('the screen is told where each part comes from — env, settings or the site — and never the token', async () => {
  configure({ token: 'env-secret-token-1', code: 'ENVTEST1' });
  let view = await metaCapi.describeConfig(TENANT);
  assert.equal(view.effective.configured, true);
  assert.equal(view.effective.pixelId, metaCapi.SITE_PIXEL_ID);
  assert.equal(view.effective.pixelSource, 'site');
  assert.equal(view.effective.tokenSource, 'env');
  assert.equal(view.effective.testEventCodeSource, 'env');
  assert.equal(view.saved.hasToken, false);
  assert.ok(!JSON.stringify(view).includes('env-secret-token-1'));

  configure({ token: 'env-secret-token-1', pixel: '777000222', settings: { metaCapi: { pixelId: '555000111', accessToken: 'own-secret-token-2', testEventCode: '' } } });
  view = await metaCapi.describeConfig(TENANT);
  assert.deepEqual(view.saved, { enabled: true, pixelId: '555000111', hasToken: true, testEventCode: '' });
  assert.equal(view.effective.pixelSource, 'settings');
  assert.equal(view.effective.tokenSource, 'settings');
  assert.equal(view.effective.testEventCodeSource, 'none');
  assert.ok(!JSON.stringify(view).includes('own-secret-token-2'));

  configure({ token: 'env-secret-token-1', settings: { metaCapi: { enabled: false } } });
  view = await metaCapi.describeConfig(TENANT);
  assert.equal(view.effective.configured, false, 'switched off on the screen');
  assert.equal(view.effective.enabled, false);

  // Another institute never borrows the platform's env or the site's pixel.
  view = await metaCapi.describeConfig('tenant-other');
  assert.equal(view.effective.pixelSource, 'none');
  assert.equal(view.effective.tokenSource, 'none');
});

test('the test event is one Lead under the test event code, answered with Meta\'s status', async () => {
  configure({ settings: { metaCapi: { pixelId: '555000111', accessToken: 'own-secret-token-2', testEventCode: 'TEST42' } } });
  const outcome = await metaCapi.sendTestEvent(TENANT, { userAgent: 'Mozilla/5.0 admin' });
  assert.deepEqual(outcome, { ok: true, status: 200, usedTestCode: true, eventsReceived: 1 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/555000111\/events\?access_token=own-secret-token-2$/);
  assert.equal(calls[0].body.test_event_code, 'TEST42');
  const [event] = calls[0].body.data;
  assert.equal(event.event_name, 'Lead');
  assert.match(event.event_id, /^admin-test-/);
  assert.equal(event.user_data.client_user_agent, 'Mozilla/5.0 admin');
  assert.equal(event.user_data.external_id.length, 1, 'hashed, naming nobody');
});

test('a setting saved a moment ago is the one tested, not the cached one', async () => {
  configure({ settings: { metaCapi: { pixelId: '555000111', accessToken: 'tok-old-123' } } });
  await metaCapi.trackLead({ tenantId: TENANT, headers: {} }, { phone: '01012345678' });
  settingsRow = { config_json: JSON.stringify({ metaCapi: { pixelId: '999000333', accessToken: 'tok-new-456' } }) };
  calls.length = 0;
  await metaCapi.sendTestEvent(TENANT);
  assert.match(calls[0].url, /\/999000333\/events\?access_token=tok-new-456$/);
});

test('a refusal or a failure comes back with its message, with the token cut out', async () => {
  configure({ settings: { metaCapi: { pixelId: '555000111', accessToken: 'own-secret-token-2' } } });
  answer = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid OAuth access token own-secret-token-2' } }) });
  let outcome = await metaCapi.sendTestEvent(TENANT);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 400);
  assert.equal(outcome.usedTestCode, false);
  assert.match(outcome.message, /Invalid OAuth access token/);
  assert.ok(!JSON.stringify(outcome).includes('own-secret-token-2'));

  answer = async () => { throw new Error('connect ECONNREFUSED for own-secret-token-2'); };
  outcome = await metaCapi.sendTestEvent(TENANT);
  assert.equal(outcome.ok, false);
  assert.ok(!JSON.stringify(outcome).includes('own-secret-token-2'));

  answer = async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); };
  assert.equal((await metaCapi.sendTestEvent(TENANT)).message, 'timeout');
  answer = async () => ({ ok: true, status: 200, json: async () => ({ events_received: 1 }) });

  configure();
  delete process.env.META_CAPI_TOKEN;
  assert.deepEqual(await metaCapi.sendTestEvent('tenant-other'), { ok: false, reason: 'not_configured' });
  assert.equal(calls.length, 0);
});

test('the routes are admin-only, the save clears the cache, and the screen keeps the token write-only', () => {
  const routes = read('api/routes/connector-diagnostics.js');
  assert.match(routes, /router\.get\('\/api\/admin\/meta-capi', requireAuth, requireAdmin, async/);
  assert.match(routes, /router\.post\('\/api\/admin\/meta-capi\/test', requireAuth, requireAdmin, connectorDiagnosticLimiter, async/);
  assert.match(read('api/lib/adminFeatureGate.js'), /'\/api\/admin\/meta-capi'\]/);
  assert.match(read('api/routes/config.js'), /hasOwnProperty\.call\(req\.body \|\| \{\}, 'metaCapi'\)\) invalidateMetaCapiConfig\(req\.tenantId\)/);
  // accessToken is one of the keys GET /api/admin/settings blanks and PUT keeps.
  const { redactSecrets, preserveStoredSecrets } = require('../lib/configSecrets');
  assert.equal(redactSecrets({ metaCapi: { accessToken: 'x' } }).metaCapi.accessToken, '');
  assert.equal(preserveStoredSecrets({ metaCapi: { accessToken: 'kept' } }, { metaCapi: { accessToken: '' } }).metaCapi.accessToken, 'kept');

  const screen = read('admin/pages/dashboard/tabs/MetaCapiSettingsTab.tsx');
  assert.match(screen, /fetch\('\/api\/admin\/meta-capi\/test'/);
  assert.match(screen, /metaCapi: \{ enabled, pixelId: pixel, testEventCode: testEventCode\.trim\(\), accessToken: newToken\.trim\(\) \}/);
  assert.match(screen, />\s*تغيير\s*</);
  assert.match(screen, /إرسال حدث تجريبي/);
  const integrations = read('admin/pages/dashboard/tabs/IntegrationsTab.tsx');
  assert.match(integrations, /\{ id: 'meta_capi', [^}]*adminOnly: true, Component: MetaCapiSettingsTab \}/);
});
