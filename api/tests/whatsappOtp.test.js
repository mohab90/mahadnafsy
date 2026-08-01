'use strict';
// WhatsApp sign-in is an authentication path, so the parts that can be tested
// without a database — number normalisation and plausibility — are pinned here.
// Normalisation is the security-relevant half: if two spellings of the same
// number don't reduce to one value, a code issued for an account can fail to
// match it, and worse, a number could be made to look like a different account.
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeWhatsAppNumber, isPlausibleNumber } = require('../lib/whatsappOtp');

test('every spelling of one Egyptian number reduces to the same digits', () => {
  const forms = [
    '01012345678',        // local
    '+201012345678',      // E.164
    '00201012345678',     // international prefix
    '0020 101 234 5678',  // spaced
    '+20-101-234-5678',   // dashed
    '201012345678',       // country code, no plus
  ];
  const normalized = forms.map(normalizeWhatsAppNumber);
  assert.equal(new Set(normalized).size, 1, `expected one value, got ${[...new Set(normalized)].join(' | ')}`);
  assert.equal(normalized[0], '1012345678');
});

test('a number is never confused with a different one', () => {
  assert.notEqual(normalizeWhatsAppNumber('01012345678'), normalizeWhatsAppNumber('01012345679'));
  assert.notEqual(normalizeWhatsAppNumber('01112345678'), normalizeWhatsAppNumber('01012345678'));
});

test('non-Egyptian numbers keep their country code', () => {
  // Only the 20 prefix is stripped; a Saudi number must stay distinct.
  assert.equal(normalizeWhatsAppNumber('+966501234567'), '966501234567');
  assert.notEqual(normalizeWhatsAppNumber('+966501234567'), normalizeWhatsAppNumber('+201234567'));
});

test('junk input normalises to empty rather than something that could match', () => {
  for (const junk of ['', null, undefined, 'abc', '+++', '  ', '--']) {
    assert.equal(normalizeWhatsAppNumber(junk), '', String(junk));
  }
});

test('plausibility rejects lengths that cannot be a real number', () => {
  assert.equal(isPlausibleNumber('1012345678'), true);
  assert.equal(isPlausibleNumber('12345678'), false);          // too short (8)
  assert.equal(isPlausibleNumber('1234567890123456'), false);  // too long (16)
  assert.equal(isPlausibleNumber(''), false);
  assert.equal(isPlausibleNumber('10123456a8'), false);        // non-digit
});

test('a normalised number is always safe to store and compare', () => {
  const out = normalizeWhatsAppNumber(' +20 (101) 234-5678 ');
  assert.match(out, /^\d+$/, 'must be digits only');
  assert.ok(isPlausibleNumber(out));
});
