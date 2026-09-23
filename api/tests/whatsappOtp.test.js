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

// ── Signup by WhatsApp ───────────────────────────────────────────────────────
// Registration and sign-in are one flow now, and that flow creates accounts from
// an unauthenticated endpoint — so what it will and will not do matters.
const { readFileSync } = require('node:fs');
const otpSource = readFileSync(require.resolve('../lib/whatsappOtp'), 'utf8');
const requestFn = otpSource.slice(
  otpSource.indexOf('async function requestLoginCode'),
  otpSource.indexOf('async function verifyLoginCode')
);
const verifyFn = otpSource.slice(otpSource.indexOf('async function verifyLoginCode'));

test('every exit from the request path reports success', () => {
  // An existing number and a brand-new one must be indistinguishable from
  // outside. Any exit that reports something else is an enumeration oracle.
  const exits = requestFn.match(/return \{[^}]*\}/g) || [];
  assert.ok(exits.length >= 2, 'expected several exits from requestLoginCode');
  for (const exit of exits) assert.match(exit, /ok: true/, `this exit leaks: ${exit}`);
});

test('an account created by OTP can never be entered by password', () => {
  // A random hash rather than NULL or '': an empty hash is the kind of value a
  // comparison elsewhere could read as "no password required".
  assert.match(verifyFn, /INSERT INTO users/, 'verification must be able to create the account');
  assert.match(verifyFn, /randomBytes\(32\)/, 'the password hash must be random, not empty');
  assert.ok(!/password_hash[^,)]*NULL/i.test(verifyFn), 'a NULL password hash must never be written');
});

test('the account is created in the same transaction that consumes the code', () => {
  // Otherwise a crash between the two burns the code and leaves no account, and
  // the customer cannot get back in until a new one is issued.
  const consume = verifyFn.indexOf("UPDATE otp_codes SET used=1 WHERE id=?");
  const insert = verifyFn.indexOf('INSERT INTO users');
  const commit = verifyFn.indexOf('conn.commit()', insert);
  assert.ok(consume > 0 && insert > consume, 'the code is consumed before the account is made');
  assert.ok(commit > insert, 'both happen before the commit');
});

test('a per-number signup throttle exists and is windowed', () => {
  // The IP limiter cannot carry this alone: rotating IPs would turn the
  // institute's own WhatsApp into a way to message any number repeatedly.
  assert.match(requestFn, /SIGNUP_CODES_PER_HOUR/, 'a per-number cap must exist');
  assert.match(requestFn, /INTERVAL 1 HOUR/, 'the cap must be measured over a window');
});

test('the per-number throttle covers registered numbers, not only signups', () => {
  // Capping only signups left the opposite hole open: nothing else in the stack
  // counts per number. The OTP request body carries only a phone, so the route's
  // `actor()` resolves to 'anonymous' and both limiters fall back to the IP —
  // rotating IPs could send a real customer unlimited WhatsApp codes.
  assert.match(requestFn, /LOGIN_CODES_PER_HOUR/,
    'a cap must exist for numbers that already have an account');
  const throttle = requestFn.slice(requestFn.indexOf('isNewAccount'));
  assert.ok(!/if \(isNewAccount\) \{\s*\/\/ The IP limiter/.test(throttle),
    'the cap must not be nested inside a new-account-only branch');
});

test('the subscriber lookup matches a number, not anything ending in it', () => {
  // `LIKE '%<identity>'` matched on a shared tail: a client stored as
  // 966501234567 was adopted by a request for 66501234567 — a different
  // country, a different person, and a number the code would be delivered to.
  assert.ok(!/LIKE \?[\s\S]{0,80}is_active=1/.test(requestFn) && !/`%\$\{normalized\}`/.test(requestFn),
    'the subscriber adoption must not use a trailing-wildcard match');
  assert.match(requestFn, /identitySpellings/,
    'it must match against the exact set of spellings of this number');
});
