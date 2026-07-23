'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCertificatePrice, priceKeyForNationality, currencyForPriceKey } = require('../lib/certificatePricing');

test('priceKeyForNationality maps each nationality to its pricing column, defaulting foreigners to USD', () => {
  assert.equal(priceKeyForNationality('EGYPTIAN'), 'egyptianEGP');
  assert.equal(priceKeyForNationality('NON_EGYPTIAN_EGYPT'), 'residentEGP');
  assert.equal(priceKeyForNationality('SAUDI_RESIDENT'), 'residentSAR');
  assert.equal(priceKeyForNationality('INTERNATIONAL'), 'foreignUSD');
  assert.equal(priceKeyForNationality(null), 'foreignUSD');
  assert.equal(priceKeyForNationality('unknown-value'), 'foreignUSD');
});

test('currencyForPriceKey derives the currency from the column suffix', () => {
  assert.equal(currencyForPriceKey('residentSAR'), 'SAR');
  assert.equal(currencyForPriceKey('foreignUSD'), 'USD');
  assert.equal(currencyForPriceKey('egyptianEGP'), 'EGP');
  assert.equal(currencyForPriceKey('residentEGP'), 'EGP');
});

test('resolveCertificatePrice: a configured price yields PRICED with the right currency', () => {
  const pricingConfig = { institute: { egyptianEGP: 500, residentSAR: 200, foreignUSD: 80 } };
  const egyptian = resolveCertificatePrice({ type: 'INSTITUTE', nationality: 'EGYPTIAN', pricingConfig });
  assert.deepEqual(egyptian, { price: 500, currency: 'EGP', status: 'PRICED' });

  const saudi = resolveCertificatePrice({ type: 'INSTITUTE', nationality: 'SAUDI_RESIDENT', pricingConfig });
  assert.deepEqual(saudi, { price: 200, currency: 'SAR', status: 'PRICED' });

  const foreigner = resolveCertificatePrice({ type: 'INSTITUTE', nationality: 'INTERNATIONAL', pricingConfig });
  assert.deepEqual(foreigner, { price: 80, currency: 'USD', status: 'PRICED' });
});

test('resolveCertificatePrice: missing type, missing column, zero, or negative price all fall back to PENDING (manual pricing)', () => {
  const pricingConfig = { institute: { egyptianEGP: 0, residentEGP: -5 } };
  assert.deepEqual(resolveCertificatePrice({ type: 'INSTITUTE', nationality: 'EGYPTIAN', pricingConfig: {} }), { price: null, currency: null, status: 'PENDING' });
  assert.deepEqual(resolveCertificatePrice({ type: 'INSTITUTE', nationality: 'EGYPTIAN', pricingConfig }), { price: null, currency: null, status: 'PENDING' });
  assert.deepEqual(resolveCertificatePrice({ type: 'INSTITUTE', nationality: 'NON_EGYPTIAN_EGYPT', pricingConfig }), { price: null, currency: null, status: 'PENDING' });
  assert.deepEqual(resolveCertificatePrice({ type: undefined, nationality: 'EGYPTIAN', pricingConfig }), { price: null, currency: null, status: 'PENDING' });
});

test('resolveCertificatePrice is case-insensitive on the certificate type key', () => {
  const pricingConfig = { social_solidarity: { egyptianEGP: 300 } };
  const result = resolveCertificatePrice({ type: 'SOCIAL_SOLIDARITY', nationality: 'EGYPTIAN', pricingConfig });
  assert.deepEqual(result, { price: 300, currency: 'EGP', status: 'PRICED' });
});
