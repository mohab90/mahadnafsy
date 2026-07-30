'use strict';
// Certificate requests are customer-facing and priced, and they feed a 9-stage
// pipeline, so a validation gap here either rejects a paying customer or lets an
// unpriced/mistyped request through. This module had no test coverage.
const { test } = require('node:test');
const assert = require('node:assert');
const { validateCertificateRequest } = require('../lib/certificateRequestValidation');

test('accepts a minimal valid request and normalises the type', () => {
  const out = validateCertificateRequest({ type: 'institute' });
  assert.equal(out.error, undefined);
  assert.equal(out.value.type, 'INSTITUTE');
});

test('rejects an unknown or missing certificate type', () => {
  assert.equal(validateCertificateRequest({ type: 'FAKE_CERT' }).error, 'invalid certificate type');
  assert.equal(validateCertificateRequest({}).error, 'invalid certificate type');
  assert.equal(validateCertificateRequest(null).error, 'invalid certificate type');
});

test('every declared certificate type is accepted', () => {
  for (const t of ['SOCIAL_SOLIDARITY', 'AIN_SHAMS', 'EXPERIENCE_EXTERNAL', 'PRACTICE_EXTERNAL',
    'NATIONAL_COUNCIL', 'AMERICAN_BOARD', 'INSTITUTE', 'OTHER']) {
    assert.equal(validateCertificateRequest({ type: t }).error, undefined, t);
  }
});

test('nationality is optional but validated when present', () => {
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE' }).value.nationality, null);
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE', nationality: 'egyptian' }).value.nationality, 'EGYPTIAN');
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE', nationality: 'MARTIAN' }).error, 'invalid nationality');
});

test('price rejects negatives and non-numbers but allows zero and absence', () => {
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE', price: -1 }).error, 'invalid price');
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE', price: 'abc' }).error, 'invalid price');
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE', price: Infinity }).error, 'invalid price');
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE', price: 0 }).value.price, 0);
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE', price: '250.5' }).value.price, 250.5);
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE' }).value.price, null);
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE', price: '' }).value.price, null);
});

test('currency is restricted to the three supported currencies', () => {
  for (const c of ['EGP', 'SAR', 'USD']) {
    assert.equal(validateCertificateRequest({ type: 'INSTITUTE', currency: c.toLowerCase() }).value.currency, c);
  }
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE', currency: 'BTC' }).error, 'invalid currency');
});

test('free-text fields are trimmed and hard-capped so they cannot overflow their columns', () => {
  const long = 'x'.repeat(5000);
  const v = validateCertificateRequest({
    type: 'INSTITUTE', courseId: `  ${'c'.repeat(50)}  `, customName: long,
    nameAr: long, nameEn: long, idNumber: long, note: long,
  }).value;
  assert.equal(v.courseId.length, 36);      // varchar(36)
  assert.equal(v.customName.length, 255);   // varchar(255)
  assert.equal(v.nameAr.length, 255);
  assert.equal(v.nameEn.length, 255);
  assert.equal(v.idNumber.length, 50);      // varchar(50)
  assert.equal(v.note.length, 2000);
});

test('whitespace-only optional text collapses to empty instead of throwing', () => {
  assert.equal(validateCertificateRequest({ type: 'INSTITUTE', nameAr: '   ' }).value.nameAr, '');
});
