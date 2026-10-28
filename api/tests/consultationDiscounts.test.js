'use strict';

// Discounts for consultations: the marketing screen offered «مستشار بعينه» and
// «كل الاستشارات» rules and nothing applied them — a session was always charged
// the doctor's full fee. lib/effectivePrice.js prices a consultation by the same
// rule as a course now, and checkout-intent charges what it returns.

const test = require('node:test');
const assert = require('node:assert/strict');
const { priceItem, quoteItem, resolveEffectivePrice } = require('../lib/effectivePrice');
const { DEFAULT_RATES } = require('../lib/enrollmentPricing');

const NOW = Date.parse('2026-10-21T10:00:00Z');
const session = (extra = {}) => ({ type: 'consultation', itemId: 'th-1', currency: 'EGP', base: 1000, discounts: [], content: {}, now: NOW, ...extra });

test('a rule on the doctor, or on all consultations, comes off the fee; the doctor\'s own wins', () => {
  const all = { type: 'all_consultations', discountPercent: 10, active: true };
  const doctor = { type: 'therapist_consultation', targetId: 'th-1', discountPercent: 25, active: true, label: 'خصم د. سارة' };
  assert.equal(priceItem(session({ discounts: [all] })).price, 900);
  const both = priceItem(session({ discounts: [all, doctor] }));
  assert.deepEqual([both.price, both.discount.label], [750, 'خصم د. سارة']);
  assert.equal(priceItem(session({ itemId: 'th-2', discounts: [all, doctor] })).price, 900, 'another doctor gets the «all» rule');
});

test('course rules, the course offers and the pop-up do not touch a consultation, nor a consultation rule a course', () => {
  const content = { 'popup.enabled': '1', 'popup.discountPercent': '40', 'home.featured.courseId': 'th-1', 'home.featured.discountPercent': '50' };
  const discounts = [{ type: 'all_courses', discountPercent: 30, active: true }];
  assert.equal(priceItem(session({ discounts, content })).price, 1000);
  const course = priceItem({ ...session(), type: 'course', itemId: 'c-1', discounts: [{ type: 'all_consultations', discountPercent: 30, active: true }] });
  assert.equal(course.price, 1000);
});

test('a code on a consultation rule applies; the pop-up\'s code and the promo-codes table do not', () => {
  const discounts = [{ type: 'therapist_consultation', targetId: 'th-1', discountPercent: 20, active: true, promoCode: 'DOC20' }];
  assert.equal(priceItem(session({ discounts })).price, 1000, 'a rule with a code needs the code');
  const coded = priceItem(session({ discounts, promoCode: 'doc20' }));
  assert.deepEqual([coded.price, coded.discount.code], [800, 'DOC20']);
  const popup = priceItem(session({ content: { 'popup.enabled': '1', 'popup.discountPercent': '40', 'popup.code': 'POP40' }, promoCode: 'POP40' }));
  assert.deepEqual([popup.price, popup.promoError.code], [1000, 'PROMO_NOT_FOR_ITEM']);
  const table = priceItem(session({ promoCode: 'SUMMER', promoRow: { discount_type: 'percent', discount_value: 50 } }));
  assert.deepEqual([table.price, table.promoError.code], [1000, 'PROMO_NOT_FOR_ITEM']);
});

test('a session is due in full at its price: no cash rate, no instalment plan', () => {
  const priced = priceItem(session({ discounts: [{ type: 'all_consultations', discountPercent: 10, active: true }] }));
  assert.deepEqual(quoteItem(priced, { payMode: 'installment', rates: DEFAULT_RATES, type: 'consultation' }),
    { ...priced, payMode: 'cash', dueNow: 900, planTotal: null });
});

test('resolveEffectivePrice reads the doctor\'s fee when the caller has none, and never the promo-codes table', async () => {
  const asked = [];
  const db = {
    async query(sql, params) {
      asked.push(sql);
      if (/FROM therapists/.test(sql)) return [[{ price_egp: 1200, price_sar: 0, price_usd: 0 }]];
      throw new Error(`unexpected query: ${sql} ${params}`);
    },
  };
  const context = { discounts: [{ type: 'all_consultations', discountPercent: 25, active: true }], content: {}, rates: DEFAULT_RATES };
  const quote = await resolveEffectivePrice(db, { type: 'consultation', itemId: 'th-1', currency: 'EGP', tenantId: 't', promoCode: 'ANY', context, now: NOW });
  assert.deepEqual([quote.base, quote.dueNow, quote.promoError.code], [1200, 900, 'PROMO_NOT_FOR_ITEM']);
  assert.equal(asked.some(sql => /promo_codes/.test(sql)), false);
  assert.equal(await resolveEffectivePrice(db, { type: 'consultation', itemId: 'th-1', currency: 'SAR', tenantId: 't', context }), null, 'no fee in riyals: not for sale in them');
});
