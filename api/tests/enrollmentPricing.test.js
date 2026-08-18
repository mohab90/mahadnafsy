'use strict';
// The cash / instalment rates used to exist only in the React page, so the
// server priced every order at full list price. A customer who chose قسط was
// billed the whole course. These pin the arithmetic on the side that decides
// what is actually charged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CASH_DISCOUNT, INSTALL_DISCOUNT, INSTALL_FIRST_PCT, installmentTotal, amountDueNow,
} = require('../lib/enrollmentPricing');

test('paying in full takes the cash discount off the list price', () => {
  assert.equal(CASH_DISCOUNT, 0.15);
  assert.equal(amountDueNow(4000, 'cash'), 3400);
  assert.equal(amountDueNow(3900, 'cash'), 3315);
});

test('the instalment plan discounts the total, then bills the first share of it', () => {
  assert.equal(INSTALL_DISCOUNT, 0.07);
  assert.equal(INSTALL_FIRST_PCT, 0.25);
  assert.equal(installmentTotal(4000), 3720);
  assert.equal(amountDueNow(4000, 'installment'), 930);
});

test('neither mode ever bills the undiscounted price', () => {
  for (const base of [100, 999, 3900, 12800]) {
    assert.ok(amountDueNow(base, 'cash') < base, `cash on ${base}`);
    assert.ok(amountDueNow(base, 'installment') < base, `installment on ${base}`);
    assert.ok(installmentTotal(base) < base, `plan total on ${base}`);
  }
});

test('an unknown mode is treated as paying in full, never as the list price', () => {
  // The route normalises anything that is not 'installment' to 'cash'; this
  // guards the helper against a caller that forgets to.
  assert.equal(amountDueNow(4000, 'anything-else'), amountDueNow(4000, 'cash'));
});
