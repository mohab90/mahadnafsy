'use strict';
/**
 * «رقمين لنفس العميل» + «مطابقة رقم الهاتف تكون ب10 ارقام» (14 Oct 2026): wiring guards.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paymentModalSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

test('every save that takes a number asks who already holds it', () => {
  for (const file of ['api/routes/admin/subscribers.js', 'api/routes/subscriber-payments.js', 'api/routes/admin/leads/convert.js']) {
    assert.match(read(file), /clientHoldingPhone/, file);
  }
});


