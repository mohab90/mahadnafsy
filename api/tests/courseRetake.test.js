'use strict';

// «إعادة» (14 Oct 2026): the third booking button, beside «حجز جديد» and «قسط». Its rules live in
// lib/courseRetake.js (real-database test: integration/courseRetake); this holds the wiring.

const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentModalSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');



test('the lib refuses what would corrupt the books', () => {
  const lib = read('api/lib/courseRetake.js');
  for (const code of ['RETAKE_NOT_TAKEN', 'RETAKE_PREVIOUS_UNPAID', 'RETAKE_AMOUNT_TOO_HIGH', 'RETAKE_NO_PRICE', 'RETAKE_NEEDS_COURSE']) assert.ok(lib.includes(code), code);
  
});


