'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCountryCode,
  currencyForCountry,
  branchForCountry,
  normalizeClientIp,
  isPrivateIp,
  resolveClientContext,
} = require('../lib/clientContext');

const request = (ip, headers = {}) => ({
  ip,
  get: name => headers[String(name).toLowerCase()],
});

test('country mapping is exactly Egypt EGP, Saudi SAR, and every other country USD', () => {
  assert.equal(currencyForCountry('EG'), 'EGP');
  assert.equal(branchForCountry('EG'), 'ONLINE_EGYPT');
  assert.equal(currencyForCountry('SA'), 'SAR');
  assert.equal(branchForCountry('SA'), 'ONLINE_SAUDI');
  for (const code of ['AE', 'US', 'GB', 'DE']) {
    assert.equal(currencyForCountry(code), 'USD');
    assert.equal(branchForCountry(code), 'ONLINE_ABROAD');
  }
  assert.equal(normalizeCountryCode(' eg '), 'EG');
  assert.equal(normalizeCountryCode('XX'), null);
});

test('IP normalization supports proxies and identifies private networks', () => {
  assert.equal(normalizeClientIp('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.4'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
});

test('server geo provider owns the public customer context', async () => {
  const oldUrl = process.env.GEOIP_API_URL;
  const oldDefault = process.env.GEO_DEFAULT_COUNTRY_CODE;
  process.env.GEOIP_API_URL = 'https://geo.example.test/{ip}';
  delete process.env.GEO_DEFAULT_COUNTRY_CODE;
  const fetchImpl = async url => ({
    ok: true,
    json: async () => ({ country: url.includes('8.8.8.8') ? 'SA' : 'US' }),
  });
  try {
    const value = await resolveClientContext(request('8.8.8.8'), { fetchImpl });
    assert.deepEqual(
      { countryCode: value.countryCode, currency: value.currency, branch: value.branch, locationResolved: value.locationResolved },
      { countryCode: 'SA', currency: 'SAR', branch: 'ONLINE_SAUDI', locationResolved: true }
    );
  } finally {
    if (oldUrl === undefined) delete process.env.GEOIP_API_URL; else process.env.GEOIP_API_URL = oldUrl;
    if (oldDefault === undefined) delete process.env.GEO_DEFAULT_COUNTRY_CODE; else process.env.GEO_DEFAULT_COUNTRY_CODE = oldDefault;
  }
});

// «اتاكد ان اي عميل من السعودية بيظهر ادامه الموقع بالريال … واتاكد ثابته مفيش حاجه تغيرها».
test('a provider hiccup is not cached like an answer, and a second provider backs the first up', async () => {
  const saved = { url: process.env.GEOIP_API_URL, fb: process.env.GEOIP_FALLBACK_API_URL, def: process.env.GEO_DEFAULT_COUNTRY_CODE, ttl: process.env.GEOIP_FAILURE_TTL_MS, env: process.env.NODE_ENV };
  process.env.NODE_ENV = 'production'; // no development default: a failed lookup is genuinely unresolved
  process.env.GEOIP_API_URL = 'https://primary.example.test/{ip}';
  process.env.GEOIP_FALLBACK_API_URL = 'https://fallback.example.test/{ip}';
  delete process.env.GEO_DEFAULT_COUNTRY_CODE;
  const calls = [];
  const down = async url => { calls.push(url); if (url.includes('primary')) throw new Error('timeout'); return { ok: true, json: async () => ({ country: 'SA' }) }; };
  try {
    // Primary down → the fallback still says Saudi Arabia → riyals.
    const first = await resolveClientContext(request('198.51.100.20'), { fetchImpl: down });
    assert.equal(first.currency, 'SAR');
    assert.equal(first.locationResolved, true);
    assert.ok(calls.some(url => url.includes('fallback')), 'the second provider was asked');

    // Both down → unresolved (never a guess) …
    const bothDown = async () => { throw new Error('offline'); };
    const failed = await resolveClientContext(request('198.51.100.21'), { fetchImpl: bothDown });
    assert.equal(failed.locationResolved, false);
    // … and the failure is not pinned: once the provider is back the very next visit is right.
    require('../lib/clientContext')._test.cache.clear();
    const ok = async () => ({ ok: true, json: async () => ({ country: 'EG' }) });
    const retry = await resolveClientContext(request('198.51.100.21'), { fetchImpl: ok });
    assert.equal(retry.currency, 'EGP');
  } finally {
    for (const [key, value] of Object.entries({ NODE_ENV: saved.env, GEOIP_API_URL: saved.url, GEOIP_FALLBACK_API_URL: saved.fb, GEO_DEFAULT_COUNTRY_CODE: saved.def, GEOIP_FAILURE_TTL_MS: saved.ttl })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('failed lookups carry a seconds-long memory, successful ones the long one', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'clientContext.js'), 'utf8');
  assert.match(source, /FAILURE_TTL_MS = Math\.max\(1_000, Number\(process\.env\.GEOIP_FAILURE_TTL_MS\) \|\| 15_000\)/);
  assert.match(source, /remember\(context\(countryCode, 'geo-provider'\), CACHE_TTL_MS\)/);
  assert.doesNotMatch(source, /cache\.set\(key, \{ value, expiresAt: Date\.now\(\) \+ CACHE_TTL_MS \}\)/, 'no failure is cached for half an hour');
});

test('the site keeps the last server-given currency for display and retries a failed lookup', () => {
  const hook = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'client', 'context', 'site-data-hooks', 'useCurrency.ts'), 'utf8');
  assert.match(hook, /useState<Currency>\(readHint\)/, 'opens on the remembered currency, not always dollars');
  assert.match(hook, /RETRY_DELAYS_MS/, 'a failed lookup is asked again');
  assert.match(hook, /writeHint\(value\.currency\)/, 'only the server\'s answer is remembered');
  assert.doesNotMatch(hook, /setCurrencyState\(.*localStorage/, 'the browser never picks the price currency');
});
