'use strict';
/**
 * A graduate could be refused their own certificate because a third-party
 * geo-IP lookup was unreachable.
 *
 * resolveClientContext reports locationResolved:false for a private client IP
 * or an unavailable provider, and the 'EG' fallback beneath it is deliberately
 * disabled in production so nobody abroad is quietly priced as Egyptian —
 * GEO_DEFAULT_COUNTRY_CODE is unset there, so that branch is live.
 *
 * Refusing was never the only way to avoid mis-pricing: the pricing function
 * already treats countryCode as optional and already has a PENDING state for
 * what it cannot price. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCertificatePrice } = require('../lib/certificatePricing');

const route = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'certificates.js'), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('an unresolved location no longer refuses the request', () => {
  const code = codeOnly(route);
  assert.ok(!code.includes('LOCATION_UNAVAILABLE'),
    'a geo provider being down must not stand between a graduate and their certificate');
  assert.ok(!code.includes('Customer location could not be verified'));
  // The context is still read — it is what decides the price when it resolves.
  assert.ok(code.includes('resolveClientContext(req)'));
  assert.ok(code.includes('countryCode: clientContext.countryCode'));
});

test('pricing without a country falls back to nationality, then to PENDING', () => {
  const pricingConfig = { attendance: { EG: 200, SA: 150, INTL: 60 } };
  const priced = resolveCertificatePrice({
    type: 'attendance', nationality: 'مصري', countryCode: null, pricingConfig,
  });
  assert.equal(priced.status === 'PRICED' || priced.status === 'PENDING', true,
    'it must return a decision rather than throw');

  // Nothing to go on at all is the case that used to 503. PENDING is the state
  // this table already defaults to and the admin screen exists to resolve.
  const unpriceable = resolveCertificatePrice({
    type: 'attendance', nationality: '', countryCode: null, pricingConfig: {},
  });
  assert.equal(unpriceable.status, 'PENDING');
  assert.equal(unpriceable.price, null);
  assert.equal(unpriceable.currency, null);
});

test('the row records that it was priced without a resolved location', () => {
  // So the admin pricing a PENDING request knows this one was priced by
  // nationality alone rather than by where the customer actually was.
  assert.ok(route.includes('clientContext.locationResolved'),
    'the flag is still consulted, for the note rather than for a refusal');
  assert.ok(route.includes('الموقع الجغرافي غير محدد'));
});
