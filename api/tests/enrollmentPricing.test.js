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

// «في صفحة الانرول محتاجين اقدر اعدل خصم الكاش وخصم القسط من قسم التسويق».
// The two rates are content keys; the page and the server charge read the same
// ones, and a blank / out-of-range value never lowers the price by accident.
test('marketing can set the cash and instalment rates, and the charge follows', () => {
  const { enrollmentRates } = require('../lib/enrollmentPricing');
  const rates = enrollmentRates({ 'enroll.cashDiscountPercent': '20', 'enroll.installDiscountPercent': '10' });
  assert.equal(rates.cash, 0.2);
  assert.equal(rates.install, 0.1);
  assert.equal(amountDueNow(10000, 'cash', rates), 8000);
  assert.equal(installmentTotal(10000, rates), 9000);
  assert.equal(amountDueNow(10000, 'installment', rates), 2250);
});

test('a blank or out-of-range rate keeps the default', () => {
  const { enrollmentRates, MAX_DISCOUNT_PERCENT } = require('../lib/enrollmentPricing');
  assert.equal(MAX_DISCOUNT_PERCENT, 60);
  for (const bad of ['', 'abc', '-5', '61', '100']) {
    const rates = enrollmentRates({ 'enroll.cashDiscountPercent': bad, 'enroll.installDiscountPercent': bad });
    assert.equal(rates.cash, CASH_DISCOUNT, `cash ${bad}`);
    assert.equal(rates.install, INSTALL_DISCOUNT, `install ${bad}`);
  }
  assert.equal(enrollmentRates({ 'enroll.cashDiscountPercent': '0' }).cash, 0);
  assert.equal(enrollmentRates(undefined).cash, CASH_DISCOUNT);
});

test('the page, the checkout, the server and the admin all use the same rates', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = rel => fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
  // checkout-intent prices through lib/effectivePrice.js, which reads the rates from the content.
  assert.match(read('api/routes/lead-capture-crm.js'), /resolveEffectivePrice\(conn, \{[\s\S]{0,120}payMode: normalizedPayMode/);
  const effective = read('api/lib/effectivePrice.js');
  assert.match(effective, /getTenantSetting\('content'/);
  assert.match(effective, /rates: enrollmentRates\(safeContent\)/);
  assert.match(effective, /dueNow: amountDueNow\(priced\.price, mode, rates\)/);
  for (const page of ['client/pages/Enrollment.tsx', 'client/pages/Checkout.tsx']) {
    const src = read(page);
    assert.match(src, /enrollmentRates\(content\)/, `${page} reads the rates from the content`);
    assert.doesNotMatch(src, /\b(15|7)\s*%/, `${page} has no hard-coded rate in its text`);
  }
  const admin = read('admin/pages/dashboard/tabs/marketing-hub-sections/SiteOffersPanel.tsx');
  assert.match(admin, /enroll\.cashDiscountPercent/);
  assert.match(admin, /enroll\.installDiscountPercent/);
});
