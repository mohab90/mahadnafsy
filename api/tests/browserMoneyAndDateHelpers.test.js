'use strict';
// The browser's money and date helpers, run for real: the admin's and the site's TypeScript is compiled with the admin's esbuild (tests/support/repo.js)
// and called, so what is asserted is what a price, a discount, an instalment or a day prints — not what the source says. Where the panel and the site
// each carry a rule (the price on a card, the day «today» is), the answer is the one the server gives (api/lib/enrollmentPricing.js, api/lib/dates.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bundle } = require('./support/repo');

const priceFormat = bundle('shared/priceFormat.ts');
const enrollment = bundle('shared/enrollmentPricing.ts');
const cairo = bundle('shared/cairoDate.ts');
const catalog = bundle('admin/lib/catalogPricing.ts');
const prices = bundle('client/lib/usePrices.ts');
const balance = bundle('client/lib/itemBalance.ts');
const skip = priceFormat ? false : 'the admin dependencies are not installed';

test('a price reads with thousands grouping, Latin digits and no dead decimals, whatever type the API sent', { skip }, () => {
  assert.equal(priceFormat.formatAmount('14800.00'), '14,800', 'a DECIMAL arrives as text');
  assert.equal(priceFormat.formatAmount(14800.5), '14,800.5');
  assert.equal(priceFormat.formatAmount(0.1 + 0.2), '0.3', 'floating point noise is not printed');
  assert.equal(priceFormat.formatAmount(null), '0');
  assert.equal(priceFormat.formatAmount('abc'), '0');
  assert.equal(priceFormat.formatPrice('7900.00', 'egp'), '7,900 ج.م');
  assert.equal(priceFormat.formatPrice(400, 'SAR'), '400 ر.س');
  assert.equal(priceFormat.formatPrice(120, 'USD'), '120 $');
  assert.equal(priceFormat.formatPrice(5, 'AED'), '5 AED', 'an unknown currency keeps its code');
  assert.equal(priceFormat.formatPrice(5), '5 ج.م', 'no currency means pounds');
  assert.match(priceFormat.formatPrice(1234567.891, 'EGP'), /^1,234,567\.89 /);
});

test('a discount is real only when the old price is truly higher, compared as numbers and not as text', { skip }, () => {
  assert.equal(priceFormat.isDiscounted('11500.00', '5600.00'), true, '«11500.00» is not smaller than «5600.00»');
  assert.equal(priceFormat.isDiscounted(5600, 5600), false);
  assert.equal(priceFormat.isDiscounted(0, 5600), false);
  assert.equal(priceFormat.isDiscounted(5600, 0), false, 'a free item is not a discount');
  assert.equal(priceFormat.isDiscounted(undefined, 100), false);
  assert.equal(priceFormat.discountPercent(1000, 850), 15);
  assert.equal(priceFormat.discountPercent('3000.00', '2000.00'), 33, 'rounded to a whole percent');
  assert.equal(priceFormat.discountPercent(1000, 1000), 0);
  assert.equal(priceFormat.discountPercent(1000, 1500), 0, 'a rise is not a negative discount');
});

test('cash and instalment amounts: the rates, the instalment total and the first payment are whole pounds, and an unknown mode never takes the cheaper path', { skip }, () => {
  assert.deepEqual(enrollment.DEFAULT_RATES, { cash: 0.15, install: 0.07, first: 0.25 });
  assert.equal(enrollment.amountDueNow(10000, 'cash'), 8500);
  assert.equal(enrollment.installmentTotal(10000), 9300);
  assert.equal(enrollment.amountDueNow(10000, 'installment'), 2325, '25% of the discounted instalment total');
  assert.equal(enrollment.amountDueNow(3333, 'installment'), Math.round(Math.round(3333 * 0.93) * 0.25));
  for (const mode of ['', undefined, 'Cash', 'weekly', null]) {
    assert.equal(enrollment.amountDueNow(10000, mode), 8500, `mode ${String(mode)} pays in full, never the instalment share`);
  }
  assert.equal(enrollment.amountDueNow(0, 'cash'), 0);
  assert.equal(enrollment.percentLabel(0.15), 15);
  assert.equal(enrollment.percentLabel(0.075), 7.5);
});

test('the discounts the marketing screen sets apply when they are sane and fall back to the defaults when blank, out of range or not a number', { skip }, () => {
  const rates = content => enrollment.enrollmentRates(content);
  assert.deepEqual(rates(undefined), enrollment.DEFAULT_RATES);
  assert.deepEqual(rates({ 'enroll.cashDiscountPercent': '20', 'enroll.installDiscountPercent': '10%' }), { cash: 0.2, install: 0.1, first: 0.25 });
  assert.equal(rates({ 'enroll.cashDiscountPercent': '0' }).cash, 0, 'zero is a real setting: no discount');
  for (const typo of ['150', '-5', 'abc', '', '   ', '60.5']) {
    assert.equal(rates({ 'enroll.cashDiscountPercent': typo }).cash, 0.15, `«${typo}» must not give a course away`);
  }
  assert.equal(rates({ 'enroll.cashDiscountPercent': '60' }).cash, 0.6, 'the ceiling itself is allowed');
  const custom = rates({ 'enroll.cashDiscountPercent': '30', 'enroll.installDiscountPercent': '0' });
  assert.equal(enrollment.amountDueNow(1000, 'cash', custom), 700);
  assert.equal(enrollment.installmentTotal(1000, custom), 1000);
});

test('the institute\'s day is Cairo\'s, not the browser\'s or UTC\'s', { skip }, () => {
  // 23:30 UTC on 30 Sept is 02:30 on 1 Oct in Cairo in summer (UTC+3 after the 2023 daylight-saving return).
  const late = '2026-09-30T23:30:00Z';
  assert.equal(cairo.cairoDateOnly(late), '2026-10-01');
  assert.equal(cairo.cairoMonthOnly(late), '2026-10');
  // In winter (UTC+2) 22:30 UTC is already the next Cairo day, 21:30 is not.
  assert.equal(cairo.cairoDateOnly('2026-12-31T22:30:00Z'), '2027-01-01');
  assert.equal(cairo.cairoDateOnly('2026-12-31T21:30:00Z'), '2026-12-31');
  assert.equal(cairo.cairoDateOnly('not a date'), '');
});

test('relative days and weeks are counted on the Cairo calendar, across months and years', { skip }, () => {
  const from = '2026-03-01T10:00:00Z';
  assert.equal(cairo.cairoDaysAgo(1, from), '2026-02-28');
  assert.equal(cairo.cairoDaysAhead(30, from), '2026-03-31');
  assert.equal(cairo.cairoDaysAgo(0, from), '2026-03-01');
  assert.equal(cairo.cairoDaysAhead(1, '2026-12-31T10:00:00Z'), '2027-01-01');
  assert.equal(cairo.cairoDaysAgo(366, '2027-01-01T10:00:00Z'), '2025-12-31');
  // 1 Oct 2026 is a Thursday: the week starts on the Sunday 27 Sept, or the Monday 28 Sept.
  assert.equal(cairo.cairoWeekStart(0, '2026-10-01T10:00:00Z'), '2026-09-27');
  assert.equal(cairo.cairoWeekStart(1, '2026-10-01T10:00:00Z'), '2026-09-28');
  assert.equal(cairo.cairoWeekStart(0, '2026-10-04T10:00:00Z'), '2026-10-04', 'a Sunday starts its own week');
  assert.equal(cairo.cairoWeekStart(1, '2026-10-04T10:00:00Z'), '2026-09-28');
  assert.deepEqual(cairo.cairoMonthProgress('2026-02-10T10:00:00Z'), { dayOfMonth: 10, daysInMonth: 28 });
  assert.deepEqual(cairo.cairoMonthProgress('2028-02-10T10:00:00Z'), { dayOfMonth: 10, daysInMonth: 29 });
  assert.equal(cairo.cairoMonthStart(0, '2026-10-15T10:00:00Z'), '2026-10-01');
  assert.equal(cairo.cairoMonthStart(3, '2026-02-15T10:00:00Z'), '2025-11-01');
  assert.equal(cairo.cairoMonthStart(-1, '2026-12-15T10:00:00Z'), '2027-01-01');
});

test('an offer expiring on a day runs through that whole Cairo day, and a blank expiry never ends', { skip }, () => {
  assert.equal(cairo.isExpiryActive('', '2026-09-15T12:00:00Z'), true);
  assert.equal(cairo.isExpiryActive(null, '2026-09-15T12:00:00Z'), true);
  assert.equal(cairo.isExpiryActive('2026-09-15', '2026-09-15T12:00:00Z'), true, 'the last day is still in force');
  // 00:30 on 16 Sept in Cairo is 21:30 UTC on the 15th: it is over.
  assert.equal(cairo.isExpiryActive('2026-09-15', '2026-09-15T21:30:00Z'), false);
  assert.equal(cairo.isExpiryActive('2026-09-15T23:59:59Z', '2026-09-14T00:00:00Z'), true, 'a stored instant is read by its day');
});

test('a stored instant is shown on Cairo\'s clock, a day alone stays a day, and what a person types goes back to UTC', { skip }, () => {
  assert.equal(cairo.cairoDateTime('2026-09-24 09:45'), '2026-09-24 12:45', 'a zoneless stored value is UTC: summer Cairo is +3');
  assert.equal(cairo.cairoDateTime('2026-01-24T09:45:00Z'), '2026-01-24 11:45', 'winter Cairo is +2');
  assert.equal(cairo.cairoDateTime(''), '');
  assert.equal(cairo.cairoDateTime(null), '');
  assert.equal(cairo.cairoDay('2026-10-01T22:30:00Z'), '2026-10-02');
  assert.equal(cairo.cairoDay(undefined), '', 'a missing date is not «today»');
  assert.equal(cairo.cairoDateLabel('2026-10-18T09:00:00Z'), '18/10/2026');
  assert.equal(cairo.cairoStamp('2026-10-18T17:07:00Z'), '18/10/2026 · 8:07 م');
  assert.equal(cairo.cairoStamp('2026-10-18T00:30:00Z'), '18/10/2026 · 3:30 ص');
  assert.equal(cairo.cairoStamp('2026-10-18T09:00:00Z'), '18/10/2026 · 12:00 م', 'noon is 12, not 0');
  assert.equal(cairo.cairoStamp('2026-10-18T00:00:00Z'), '18/10/2026', 'a payment\'s day (midnight UTC) is not shown as 3 a.m.');
  assert.equal(cairo.cairoStamp('2026-10-18'), '18/10/2026');
  assert.equal(cairo.cairoStamp(''), '');
  assert.equal(cairo.cairoInputToUtc('2026-07-01T12:00'), '2026-07-01 09:00', 'typed in summer: Cairo is +3');
  assert.equal(cairo.cairoInputToUtc('2026-01-01 12:00'), '2026-01-01 10:00', 'typed in winter: Cairo is +2');
  assert.equal(cairo.cairoInputToUtc('garbage'), '');
  assert.equal(cairo.cairoDateTimeInput('2026-07-01T09:00:00Z'), '2026-07-01T12:00');
  // Round trip: what is shown in an input is what is stored.
  for (const stored of ['2026-03-20 08:15', '2026-07-04 20:59', '2026-11-30 23:00', '2026-12-31 22:30']) {
    assert.equal(cairo.cairoInputToUtc(cairo.cairoDateTimeInput(stored)), stored, stored);
  }
});

test('a payment\'s day-only value is told apart from a moment; a day typed as text is a day', { skip }, () => {
  assert.equal(cairo.isDateOnly('2026-10-18'), true);
  assert.equal(cairo.isDateOnly('2026-10-18T00:00:00.000Z'), true);
  assert.equal(cairo.isDateOnly('2026-10-18T09:00:00Z'), false);
  assert.equal(cairo.isDateOnly(''), false);
  assert.equal(cairo.isDateOnly(null), false);
  assert.equal(cairo.isDateOnly(undefined), false);
});

test('the price tier of a branch splits by nationality only where the price list does', { skip }, () => {
  assert.equal(catalog.tierForBranch('ONLINE_EGYPT'), 'ONLINE_EGYPT');
  assert.equal(catalog.tierForBranch('online_egypt', 'NON_EGYPTIAN_EGYPT'), 'ONLINE_EGYPT_FOREIGN');
  assert.equal(catalog.tierForBranch('DAQQI', 'non_egyptian_egypt'), 'DAQQI_FOREIGN');
  assert.equal(catalog.tierForBranch('DAQQI', 'EGYPTIAN'), 'DAQQI');
  assert.equal(catalog.tierForBranch('TAGAMOA', 'NON_EGYPTIAN_EGYPT'), 'TAGAMOA', 'Tagamoa has one list');
  assert.equal(catalog.tierForBranch('ONLINE_SAUDI', 'NON_EGYPTIAN_EGYPT'), 'ONLINE_SAUDI');
  assert.equal(catalog.tierForBranch('ONLINE_ABROAD'), 'ONLINE_ABROAD');
  for (const unknown of ['', null, undefined, 'MARS']) assert.equal(catalog.tierForBranch(unknown), null, String(unknown));
  assert.deepEqual([...catalog.DISCOUNT_PERCENTS], [5, 10, 15, 20, 25, 30, 40, 50]);
});

test('catalogue money prints with its currency name, and a missing price is a dash', { skip }, () => {
  assert.equal(catalog.formatMoney(null, 'EGP'), '—');
  assert.equal(catalog.formatMoney(undefined, 'SAR'), '—');
  assert.equal(catalog.formatMoney(1500, 'EGP'), '1,500 جنيه');
  assert.equal(catalog.formatMoney(99.5, 'USD'), '99.5 دولار');
  assert.equal(catalog.formatMoney(0, 'SAR'), '0 ريال', 'zero is a price, not a missing one');
});

test('the site\'s effective price is the one the server charges, in the right currency; the catalogue price stands until the list has loaded', { skip }, () => {
  const list = {
    'course:c1': { EGP: { base: 4000, price: 3400, discount: { source: 'marketing', percent: 15, label: '15%', expiresAt: null } }, SAR: { base: 400, price: 0, discount: null } },
  };
  const egp = prices.effectivePrice(list, 'course', 'c1', 'EGP', 4000);
  assert.deepEqual([egp.base, egp.price, egp.loaded, egp.discount.percent], [4000, 3400, true, 15]);
  const sar = prices.effectivePrice(list, 'course', 'c1', 'SAR', 410);
  assert.deepEqual([sar.price, sar.loaded], [410, false], 'a zero entry is not a price: the catalogue is shown');
  assert.deepEqual([prices.effectivePrice({}, 'course', 'c1', 'EGP', 4000).price, prices.effectivePrice(list, 'bundle', 'c1', 'EGP', 9).price], [4000, 9]);
  assert.equal(prices.effectivePrice(list, 'course', null, 'EGP', 7).price, 7);
  assert.equal(prices.effectivePrice(list, 'course', 'c1', 'USD', 7).price, 7, 'a currency the list does not carry');
});

test('the struck-out price is the larger of the catalogue\'s «was» and the base a discount took the price down from', { skip }, () => {
  const discounted = { base: 4000, price: 3400, discount: null, loaded: true };
  assert.equal(prices.wasPrice(discounted, 0), 4000);
  assert.equal(prices.wasPrice(discounted, 5000), 5000);
  assert.equal(prices.wasPrice({ base: 4000, price: 4000, discount: null, loaded: true }, 0), 0, 'no discount, no strikethrough');
  assert.equal(prices.wasPrice({ base: 4000, price: 4000, discount: null, loaded: true }, '4500'), 4500);
});

test('a course shown with its effective prices keeps the currencies the list does not carry and never mutates the original', { skip }, () => {
  const list = { 'course:c1': { EGP: { base: 4000, price: 3400, discount: null } } };
  const course = { id: 'c1', price: { EGP: 4000, SAR: 400, USD: 90 }, originalPrice: { SAR: 500 } };
  const shown = prices.withEffectivePrices(list, 'course', course);
  assert.deepEqual(shown.price, { EGP: 3400, SAR: 400, USD: 90 });
  assert.equal(shown.originalPrice.EGP, 4000, 'the base becomes the «was» price');
  assert.equal(shown.originalPrice.SAR, 500);
  assert.deepEqual(course.price, { EGP: 4000, SAR: 400, USD: 90 }, 'the input is untouched');
  assert.equal(prices.withEffectivePrices(list, 'course', { id: 'other', price: { EGP: 1 } }).price.EGP, 1, 'an item the list does not carry is returned as it is');
  assert.equal(prices.withEffectivePrices(list, 'bundle', course), course, 'the key is the kind and the id together');
});

test('an item\'s balance is attached to each course of a track bought as a track, and a course\'s own balance wins', { skip }, () => {
  const bundles = [{ id: 'b1', courses: [{ id: 'c1' }, { id: 'c2' }] }];
  const balances = [
    { bundleId: 'b1', title: 'The track', remaining: 1000, currency: 'EGP' },
    { courseId: 'c2', title: 'Course two', remaining: 250, currency: 'EGP' },
  ];
  const byCourse = balance.balancesByCourse(balances, bundles);
  assert.equal(byCourse.c1.trackTitle, 'The track');
  assert.equal(byCourse.c1.remaining, 1000);
  assert.equal(byCourse.c2.remaining, 250, 'a course with a balance of its own keeps it');
  assert.equal(byCourse.c2.trackTitle, undefined);
  assert.deepEqual(balance.balancesByCourse([], bundles), {});
  assert.deepEqual(balance.balancesByCourse([{ bundleId: 'gone', title: 'x', remaining: 1 }], bundles), {}, 'a track the catalogue no longer has adds nothing');
  assert.deepEqual(['SAR', 'USD', 'EGP', undefined, 'JPY'].map(balance.moneySuffix), ['ر.س', '$', 'ج.م', 'ج.م', 'ج.م']);
});
