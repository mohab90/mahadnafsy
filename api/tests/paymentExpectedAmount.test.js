'use strict';
// What a customer owes for a course, when the person recording the payment did
// not say.
//
// course_expected used to default to the payment itself for any non-instalment
// payment. So a 690 payment against a 3,400 course wrote "expected 690", and
// everything downstream believed it: entitlements grant full access on
// paid >= expected, the remaining-balance column reads zero, and the
// collections list never shows them again. Sixty-five customers hold full
// access having paid less than their course's price.
//
// Now it defaults to the price the client agreed (lib/agreedPrice.js): their
// own price, else their booking's, else the catalogue.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
const code = codeOnly(read('routes/subscriber-payments.js'));
const agreed = codeOnly(read('lib/agreedPrice.js'));

test('an unstated expectation falls back to the agreed price, and then the catalogue', () => {
  assert.match(code, /resolvedExpected = await agreedPrice\(pool, \{/,
    'the price has to come from what the client agreed, not the payment');
  assert.match(code, /require\('\.\.\/lib\/agreedPrice'\)/);
  // The client's own price, then their booking's, then the catalogue.
  assert.ok(agreed.indexOf('customPrices') < agreed.indexOf('MAX(course_expected)'));
  assert.ok(agreed.indexOf('MAX(course_expected)') < agreed.indexOf('resolveCatalogPrice('));
});

test('a stated expectation still wins', () => {
  // An agreed price below list — a discount, a partial enrolment — is exactly
  // what supplying courseExpected is for. The fallback must only apply when
  // nothing was supplied.
  // A tier the desk chose is the catalogue's price for that branch (lib/priceTiers.js),
  // unless a manager set the client's own price (set_client_price, 7 Oct 2026).
  assert.match(code, /let resolvedExpected = clientPrice \? courseExpected : tierPrice \? tierPrice\.price : courseExpected;/);
  assert.match(code, /if \(resolvedExpected == null && \(courseId \|\| bundleId\)\)/);
});

test('an instalment records the course\'s agreed price, never its own amount', () => {
  // course_expected is the whole course's price on every row of it — the
  // collections list reads MAX(course_expected) per course. An instalment's own
  // amount there would make each one look like the whole debt.
  assert.doesNotMatch(code, /courseExpected != null \? courseExpected : \(payment\.isInstallment \? null : paymentAmount\)/,
    'the old self-fulfilling default must be gone');
  assert.match(code, /if \(resolvedExpected == null && !payment\.isInstallment\) resolvedExpected = paymentAmount;/);
});

test('a course with no price anywhere falls back to the amount, not to zero', () => {
  // Zero would read as "owes nothing" everywhere, which is the same bug facing
  // the other way. A course with no price cannot say the payment was short.
  assert.match(code, /resolvedExpected = paymentAmount;/);
});

test('a price the desk enters becomes the client\'s price everywhere', () => {
  assert.match(code, /await setAgreedPrice\(conn, \{/);
  assert.match(agreed, /UPDATE payments SET course_expected=\?/);
  assert.match(agreed, /crm\.customPrices = \{ \.\.\.\(crm\.customPrices \|\| \{\}\), \[itemKey\(\{ courseId, bundleId \}\)\]: value \};/);
  // And the access check reads the agreed price, not only a supplied one.
  assert.match(code, /expectedAmount: resolvedExpected,/);
});
