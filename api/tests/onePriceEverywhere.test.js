'use strict';

// L2 of the 20 Oct 2026 review: the course page took a marketing discount off,
// the card did not, the home page took two, and checkout charged the catalogue
// price — 2,800 on the page, 3,600 asked for. One rule now (lib/effectivePrice.js),
// shown by GET /api/public/prices and charged by checkout-intent and reserve.

const test = require('node:test');
const assert = require('node:assert/strict');
const { priceItem, quoteItem, automaticDiscounts, codeDiscount } = require('../lib/effectivePrice');
const { DEFAULT_RATES } = require('../lib/enrollmentPricing');

const NOW = Date.parse('2026-10-21T10:00:00Z');
const course = (extra = {}) => ({ type: 'course', itemId: 'c-1', currency: 'EGP', base: 3600, discounts: [], content: {}, now: NOW, ...extra });

test('no discount running: the list price is the catalogue price', () => {
  const p = priceItem(course());
  assert.deepEqual([p.base, p.list, p.price, p.discount], [3600, 3600, 3600, null]);
});

test("a rule without a code is taken off; the item's own rule wins over «all courses»", () => {
  const discounts = [
    { type: 'all_courses', discountPercent: 30, active: true },
    { type: 'course', targetId: 'c-1', discountPercent: 22, active: true, label: 'خصم العيد', expiresAt: '2026-10-30' },
  ];
  const p = priceItem(course({ discounts }));
  assert.equal(p.price, 2808);
  assert.deepEqual([p.discount.source, p.discount.percent, p.discount.label, p.discount.expiresAt], ['rule', 22, 'خصم العيد', '2026-10-30']);
  assert.equal(priceItem(course({ itemId: 'c-2', discounts })).price, 2520, 'another course gets «all courses»');
});

test('a rule that is off, expired, or has a code applies to nobody automatically', () => {
  for (const rule of [
    { type: 'course', targetId: 'c-1', discountPercent: 20, active: false },
    { type: 'course', targetId: 'c-1', discountPercent: 20, active: true, expiresAt: '2026-10-20' },
    { type: 'course', targetId: 'c-1', discountPercent: 20, active: true, promoCode: 'EID20' },
    { type: 'course', targetId: 'c-1', discountPercent: 100, active: true },
  ]) assert.equal(priceItem(course({ discounts: [rule] })).price, 3600, JSON.stringify(rule));
  // An expiry runs through its Cairo day: 23:30 UTC on the 20th is already the 21st in Cairo.
  const lastDay = { type: 'course', targetId: 'c-1', discountPercent: 10, active: true, expiresAt: '2026-10-21' };
  assert.equal(priceItem(course({ discounts: [lastDay], now: Date.parse('2026-10-20T23:30:00Z') })).price, 3240);
});

test('bundle rules price bundles; «all courses» does not', () => {
  const discounts = [{ type: 'all_courses', discountPercent: 30, active: true }, { type: 'bundle', targetId: 'b-1', discountPercent: 10, active: true }];
  assert.equal(priceItem({ ...course({ discounts }), type: 'bundle', itemId: 'b-1', base: 9000 }).price, 8100);
  assert.equal(priceItem({ ...course({ discounts }), type: 'bundle', itemId: 'b-2', base: 9000 }).price, 9000);
});

test('the featured course, the timed offer and a code-less pop-up are real prices, and the cheapest one is charged', () => {
  const content = {
    'home.featured.courseId': 'c-1', 'home.featured.discountPercent': '10',
    'offer.courseId': 'c-1', 'offer.price.EGP': '2999', 'offer.timerStartedAt': '2026-10-21T00:00:00Z', 'offer.durationHours': '24',
    'popup.enabled': '1', 'popup.courseId': 'c-1', 'popup.discountPercent': '5',
  };
  const found = automaticDiscounts({ ...course({ content }) }).map(d => [d.source, d.price]);
  assert.deepEqual(found, [['featured', 3240], ['offer', 2999], ['popup', 3420]]);
  const p = priceItem(course({ content }));
  assert.deepEqual([p.price, p.discount.source], [2999, 'offer'], 'they do not stack');
  // The countdown ran out: the offer's price is gone with it.
  assert.equal(priceItem(course({ content, now: Date.parse('2026-10-22T01:00:00Z') })).price, 3240);
  // The offer's price is per currency: none typed in riyals, none there.
  assert.equal(priceItem(course({ content, currency: 'SAR', base: 450 })).price, 405);
});

test('a code: rule codes, the pop-up code and promo_codes rows, best of with the automatic price', () => {
  const discounts = [{ type: 'course', targetId: 'c-1', discountPercent: 20, active: true, promoCode: 'EID20' }];
  const content = { 'popup.enabled': '1', 'popup.code': 'WELCOME', 'popup.discountPercent': '25', 'popup.courseId': '' };
  const withRule = priceItem(course({ discounts, content, promoCode: 'eid20' }));
  assert.deepEqual([withRule.price, withRule.discount.code, withRule.promoError], [2880, 'EID20', null]);
  const withPopup = priceItem(course({ discounts, content, promoCode: 'WELCOME' }));
  assert.deepEqual([withPopup.price, withPopup.discount.source], [2700, 'code']);
  // The pop-up's code with no course is for any course — and only while the pop-up runs.
  assert.equal(priceItem(course({ discounts, content: { ...content, 'popup.endsAt': '2026-10-20T00:00:00Z' }, promoCode: 'WELCOME' })).promoError.code, 'PROMO_INVALID');
  const percentRow = { discount_type: 'percent', discount_value: 15, min_order_amount: 0, description: 'كود' };
  assert.equal(priceItem(course({ promoCode: 'X15', promoRow: percentRow })).price, 3060);
  const unknown = priceItem(course({ promoCode: 'NOPE' }));
  assert.deepEqual([unknown.price, unknown.promoError.code], [3600, 'PROMO_INVALID']);
  // A weaker code than the discount already running: they pay the lower, and are told why.
  const running = [{ type: 'course', targetId: 'c-1', discountPercent: 30, active: true }];
  const weaker = priceItem(course({ discounts: running, promoCode: 'X15', promoRow: percentRow }));
  assert.deepEqual([weaker.price, weaker.discount.source, weaker.promoError.code], [2520, 'rule', 'PROMO_NOT_BETTER']);
});

test('a fixed-amount code and a minimum order are pounds', () => {
  const fixed = { discount_type: 'fixed', discount_value: 500, min_order_amount: 4000 };
  assert.equal(codeDiscount('F500', { ...course(), promoRow: fixed }).error.code, 'PROMO_MIN_ORDER');
  assert.equal(codeDiscount('F500', { ...course({ base: 5000 }), promoRow: fixed }).discount.price, 4500);
  assert.equal(codeDiscount('F500', { ...course({ currency: 'USD', base: 90 }), promoRow: fixed }).error.code, 'PROMO_EGP_ONLY');
  assert.equal(codeDiscount('F500', { ...course({ base: 400 }), promoRow: { ...fixed, min_order_amount: 0 } }).error.code, 'PROMO_INVALID', 'never down to zero');
});

test('the pay mode goes on top of the list price, as checkout always applied it', () => {
  const discounts = [{ type: 'course', targetId: 'c-1', discountPercent: 22, active: true }];
  const priced = priceItem(course({ discounts }));
  const cash = quoteItem(priced, { payMode: 'cash', rates: DEFAULT_RATES });
  assert.deepEqual([cash.dueNow, cash.planTotal], [Math.round(2808 * 0.85), null]);
  const plan = quoteItem(priced, { payMode: 'installment', rates: DEFAULT_RATES });
  assert.deepEqual([plan.planTotal, plan.dueNow], [Math.round(2808 * 0.93), Math.round(Math.round(2808 * 0.93) * 0.25)]);
});

test('every screen that shows a course or path price reads the server price, and checkout sends the code', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = rel => fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
  for (const rel of ['client/components/CourseCard.tsx', 'client/pages/CourseDetails.tsx', 'client/pages/Home.tsx', 'client/pages/HomeClassic.tsx',
    'client/components/SpecialOffer.tsx', 'client/components/home/OfferSpotlight.tsx', 'client/components/home/PathsSection.tsx',
    'client/pages/Bundles.tsx', 'client/pages/BundleDetails.tsx', 'client/pages/Enrollment.tsx', 'client/pages/Checkout.tsx']) {
    assert.match(read(rel), /from '(\.\.\/)+lib\/usePrices'/, rel);
  }
  assert.match(read('client/lib/usePrices.ts'), /fetch\('\/api\/public\/prices'\)/);
  const checkout = read('client/pages/Checkout.tsx');
  assert.match(checkout, /fetch\('\/api\/public\/price-quote'/);
  assert.match(checkout, /\.\.\.\(promo \? \{ promoCode: promo\.code \} : \{\}\)/);
  assert.match(read('api/routes/lead-capture-crm.js'), /promoCode: wantedCode, base: basePrice, context: pricingContext/);
});
