'use strict';
// The delivery half of this module is the one that was broken in production:
// a number stored as 01012345678 was addressed as 1012345678, which is not a
// number anywhere, so the message silently went nowhere. These pin both shapes
// and, most importantly, that they are NOT the same value.
const { test } = require('node:test');
const assert = require('node:assert');
const { toIdentity, toDialable, toDisplay, isDialable, isPlausible, identitySpellings } = require('../lib/phoneNumber');

const SPELLINGS = [
  '01012345678',        // local — how customers actually type it
  '+201012345678',      // E.164
  '00201012345678',     // international prefix
  '0020 101 234 5678',  // spaced
  '+20-101-234-5678',   // dashed
  '201012345678',       // country code, no plus
  ' 01012345678 ',      // padded
];

test('every spelling of one Egyptian number has the same identity', () => {
  const keys = SPELLINGS.map(toIdentity);
  assert.equal(new Set(keys).size, 1, `expected one key, got ${[...new Set(keys)].join(' | ')}`);
  assert.equal(keys[0], '1012345678');
});

test('every spelling dials the same full international number', () => {
  const dialed = SPELLINGS.map(toDialable);
  assert.equal(new Set(dialed).size, 1, `expected one address, got ${[...new Set(dialed)].join(' | ')}`);
  assert.equal(dialed[0], '201012345678');
});

test('the dialable form is never the identity form', () => {
  // This is the regression. The old sender used the identity shape as the
  // delivery address; the country code is exactly what was missing.
  const local = '01012345678';
  assert.notEqual(toDialable(local), toIdentity(local));
  assert.ok(toDialable(local).startsWith('20'), 'delivery address must carry the country code');
});

test('every Egyptian mobile prefix is completed, and only those', () => {
  for (const prefix of ['10', '11', '12', '15']) {
    const n = `0${prefix}12345678`;
    assert.equal(toDialable(n), `20${prefix}12345678`, `prefix ${prefix} must dial with country code`);
  }
  // 013 is not an Egyptian mobile prefix, and 10 digits is too short to already
  // carry a country code — so there is no address to build. Refusing beats
  // guessing: '1312345678' would have been handed to the provider as though it
  // were international, and 20-prefixing it would ring a stranger's phone.
  assert.equal(toDialable('01312345678'), '');
});

test('a foreign number keeps its own country code and is never given ours', () => {
  assert.equal(toDialable('+966501234567'), '966501234567');
  assert.equal(toDialable('00966501234567'), '966501234567');
  assert.equal(toDialable('+971501234567'), '971501234567');
  assert.ok(!toDialable('+966501234567').startsWith('20966'), 'must not prepend the Egyptian code');
});

test('a Saudi and an Egyptian number never collapse into each other', () => {
  assert.notEqual(toIdentity('+966501234567'), toIdentity('+201012345678'));
  assert.notEqual(toDialable('+966501234567'), toDialable('+201012345678'));
});

test('junk is undialable rather than sent to a wrong address', () => {
  for (const junk of ['', null, undefined, 'abc', '+++', '  ', '--', '0', '00', '+20']) {
    assert.equal(toDialable(junk), '', `junk produced an address: ${String(junk)}`);
    assert.equal(isDialable(junk), false, String(junk));
  }
});

test('a number too short or too long to be real is undialable', () => {
  assert.equal(toDialable('12345678'), '', '8 digits is below any real number');
  assert.equal(toDialable('1234567890123456'), '', '16 digits is above any real number');
  assert.equal(isPlausible('123456789'), true);
  assert.equal(isPlausible('123456789012345'), true);
});

test('an Egyptian landline stays undialable instead of being guessed at', () => {
  // 9 national digits starting 2 — a Cairo landline. It is not on WhatsApp, and
  // guessing a country code for it would address a live mobile somewhere else.
  assert.equal(toDialable('0223456789'), '', 'a landline must not be completed into a mobile');
});

test('display form is the dialable number with a plus', () => {
  assert.equal(toDisplay('01012345678'), '+201012345678');
  assert.equal(toDisplay('nonsense'), '');
});

test('identity is stable when applied twice', () => {
  // Records get normalised on write and again on read; the second pass must not
  // strip anything further or two saves of one number would drift apart.
  for (const n of SPELLINGS.concat(['+966501234567'])) {
    assert.equal(toIdentity(toIdentity(n)), toIdentity(n), n);
  }
});

test('dialable is stable when applied twice', () => {
  for (const n of SPELLINGS.concat(['+966501234567'])) {
    assert.equal(toDialable(toDialable(n)), toDialable(n), n);
  }
});

// ── identitySpellings ───────────────────────────────────────────────────────
// Regression cover for the subscriber-adoption match in lib/whatsappOtp.js.
// That lookup used `REGEXP_REPLACE(phone,'[^0-9]','') LIKE '%<identity>'`, which
// matches on a shared tail rather than on the number itself.

test('identitySpellings covers the ways an Egyptian number gets stored', () => {
  const spellings = identitySpellings('01012345678');
  assert.ok(spellings.includes('1012345678'), 'identity form');
  assert.ok(spellings.includes('01012345678'), 'local form with trunk zero');
  assert.ok(spellings.includes('201012345678'), 'international form');
  assert.ok(spellings.includes('00201012345678'), '00-prefixed international form');
});

test('identitySpellings treats every spelling of one number as that same number', () => {
  const fromLocal = identitySpellings('01012345678').slice().sort();
  const fromIntl = identitySpellings('+20 101 234 5678').slice().sort();
  assert.deepEqual(fromLocal, fromIntl);
});

test('identitySpellings never returns a value another number ends with', () => {
  // The reported case: a Saudi client stored as 966501234567 was adopted by a
  // request for 66501234567, because the stored digits end with those digits.
  const attacker = identitySpellings('66501234567');
  assert.ok(!attacker.includes('966501234567'),
    'must not produce the victim number it is merely a tail of');
  // And the reverse: the victim's own spellings must not include the tail.
  const victim = identitySpellings('966501234567');
  assert.ok(!victim.includes('66501234567'),
    'a shorter tail is a different number, not a spelling of this one');
});

test('identitySpellings does not put an Egyptian country code on a foreign number', () => {
  for (const spelling of identitySpellings('966501234567')) {
    assert.ok(!spelling.startsWith('20966'), `invented a spelling: ${spelling}`);
  }
});

test('identitySpellings returns nothing for junk', () => {
  assert.deepEqual(identitySpellings(''), []);
  assert.deepEqual(identitySpellings('abc'), []);
  assert.deepEqual(identitySpellings(null), []);
});
