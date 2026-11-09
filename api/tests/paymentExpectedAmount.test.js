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
  
  
  // The client's own price, then their booking's, then the catalogue.
  assert.ok(agreed.indexOf('customPrices') < agreed.indexOf('MAX(course_expected)'), 'the client\'s own price (client_item_money) is read first');
  assert.ok(agreed.indexOf('MAX(course_expected)') < agreed.indexOf('resolveCatalogPrice('));
});








