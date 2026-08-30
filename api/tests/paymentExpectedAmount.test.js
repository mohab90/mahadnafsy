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
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'subscriber-payments.js'), 'utf8');
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');

test('the catalogue price is what an unstated expectation falls back to', () => {
  assert.match(code, /resolveCatalogPrice/,
    'the course price has to come from the catalogue, not the payment');
  assert.match(code, /require\('\.\.\/lib\/catalogPrice'\)/,
    'and the helper has to actually be imported');
});

test('a stated expectation still wins', () => {
  // An agreed price below list — a discount, a partial enrolment — is exactly
  // what supplying courseExpected is for. The fallback must only apply when
  // nothing was supplied.
  assert.match(code, /resolvedExpected\s*=\s*courseExpected/);
  assert.match(code, /if \(resolvedExpected == null && !payment\.isInstallment\)/);
});

test('an instalment still records no expectation of its own', () => {
  // An instalment is a part payment by definition; writing the course price
  // onto every instalment row would make each one look like the whole debt.
  assert.doesNotMatch(code, /courseExpected != null \? courseExpected : \(payment\.isInstallment \? null : paymentAmount\)/,
    'the old self-fulfilling default must be gone');
  assert.match(code, /!payment\.isInstallment/);
});

test('a course with no catalogue price falls back to the amount, not to zero', () => {
  // Zero would read as "owes nothing" everywhere, which is the same bug facing
  // the other way. A course with no price cannot say the payment was short.
  assert.match(code, /catalogue != null && catalogue > 0 \? catalogue : paymentAmount/);
});
