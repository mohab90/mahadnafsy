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
