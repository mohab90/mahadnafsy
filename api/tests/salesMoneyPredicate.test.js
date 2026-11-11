'use strict';
// One predicate for "sales money" (lib/salesMoney.js), and it is the rule the course-balance code states: lib/agreedPrice.js
// ITEM_PAYMENT_SQL / ITEM_PAYMENT_TYPES. If either changes without the other, a rep's revenue and a client's course balance would
// start disagreeing about which payments are the course's.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SALES_PAYMENT_TYPES, salesPaymentSql } = require('../lib/salesMoney');
const { ITEM_PAYMENT_TYPES, ITEM_PAYMENT_SQL } = require('../lib/agreedPrice');

test('sales money is course and track money: the same types and the same SQL as the course balances', () => {
  assert.deepEqual([...SALES_PAYMENT_TYPES], [...ITEM_PAYMENT_TYPES]);
  assert.equal(salesPaymentSql('p'), ITEM_PAYMENT_SQL);
  assert.equal(salesPaymentSql(), ITEM_PAYMENT_SQL, 'the default alias is p');
  assert.equal(salesPaymentSql('pay'), ITEM_PAYMENT_SQL.replace('p.payment_type', 'pay.payment_type'));
  assert.ok(!SALES_PAYMENT_TYPES.includes('CERTIFICATE'), 'certificate money is collection');
});
