'use strict';
/**
 * The checkout's price block (client/components/checkout/PriceRows.tsx, EgyptianIdLine.tsx) rendered to markup in each state:
 *  - OFF (no Egyptian prop, no line): byte for byte the markup the order summary printed before the Egypt site's two prices existed
 *    (the literals below were captured from the rows as they were when they were moved out of Checkout.tsx, before the new prop was added);
 *  - ON without an ID: the shown price and the one-line invitation;
 *  - ON with a valid ID: the shown price struck through, «خصم المصريين», «سعر المصري», and a code's own discount below it.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bundle } = require('./support/repo');
const render = bundle('api/tests/support/checkoutRender.tsx');
const skip = !render && 'esbuild not installed';

const rates = { cash: 0.15, install: 0.07, first: 0.25 };
const base = { discountable: true, basePrice: 2800, itemPrice: 2800, listPrice: 2800, finalAmount: 2380, payMode: 'cash', planTotal: null, promoCode: null, rates, currencySymbol: 'ج.م' };

const BEFORE = {
  cash: "<div class=\"mb-4 space-y-2.5 text-sm text-muted-body\"><div class=\"flex justify-between gap-3\"><span>السعر الأساسي</span><span class=\"tabular-nums text-ink\">2800 ج.م</span></div><div class=\"flex justify-between gap-3 font-bold text-green-700\"><span>خصم الدفع الكامل (15%)</span><span class=\"tabular-nums\">− 420 ج.م</span></div></div>",
  promo: "<div class=\"mb-4 space-y-2.5 text-sm text-muted-body\"><div class=\"flex justify-between gap-3\"><span>السعر الأساسي</span><span class=\"tabular-nums text-ink\">2800 ج.م</span></div><div class=\"flex justify-between gap-3 font-bold text-green-700\"><span>كود الخصم TEN</span><span class=\"tabular-nums\">− 280 ج.م</span></div><div class=\"flex justify-between gap-3 font-bold text-green-700\"><span>خصم الدفع الكامل (15%)</span><span class=\"tabular-nums\">− 378 ج.م</span></div></div>",
  installment: "<div class=\"mb-4 space-y-2.5 text-sm text-muted-body\"><div class=\"flex justify-between gap-3\"><span>السعر الأساسي</span><span class=\"tabular-nums text-ink\">2800 ج.م</span></div><div class=\"flex justify-between gap-3 font-bold text-green-700\"><span>خصم التقسيط (7%)</span><span class=\"tabular-nums\">− 196 ج.م</span></div><div class=\"flex justify-between gap-3 font-extrabold text-ink\"><span>إجمالي الكورس بعد الخصم</span><span class=\"tabular-nums\">2604 ج.م</span></div><div class=\"flex justify-between gap-3 font-bold text-gold-deep\"><span>الباقي على أقساط</span><span class=\"tabular-nums\">1953 ج.م</span></div></div>",
  notDiscountable: "<div class=\"mb-4 space-y-2.5 text-sm text-muted-body\"><div class=\"flex justify-between gap-3\"><span>السعر الأساسي</span><span class=\"tabular-nums text-ink\">2800 ج.م</span></div></div>",
};

test('OFF: the price rows are byte for byte what they were', { skip }, () => {
  assert.equal(render.renderRows(base), BEFORE.cash);
  assert.equal(render.renderRows({ ...base, egyptian: null }), BEFORE.cash);
  assert.equal(render.renderRows({ ...base, listPrice: 2520, finalAmount: 2142, promoCode: 'TEN' }), BEFORE.promo);
  assert.equal(render.renderRows({ ...base, payMode: 'installment', finalAmount: 651, planTotal: 2604 }), BEFORE.installment);
  assert.equal(render.renderRows({ ...base, discountable: false, finalAmount: 2800 }), BEFORE.notDiscountable);
});

test('ON with a valid ID: the shown price is struck through, then the Egyptians discount and the Egyptian price', { skip }, () => {
  const html = render.renderRows({ ...base, basePrice: 3400, itemPrice: 3400, listPrice: 2800, finalAmount: 2380, egyptian: { discount: 600 } });
  assert.ok(html.includes('line-through">3400 ج.م<'), html);
  assert.ok(html.includes('<span>خصم المصريين</span><span class="tabular-nums">− 600 ج.م</span>'), html);
  assert.ok(html.includes('<span>سعر المصري</span><span class="tabular-nums">2800 ج.م</span>'), html);
  assert.ok(!html.includes('خصم العرض'), 'nothing else came off, so no other discount line');
  // a code on top of the Egyptian price keeps its own line, and it is the code's amount only
  const withCode = render.renderRows({ ...base, basePrice: 3400, itemPrice: 3400, listPrice: 2520, finalAmount: 2142, promoCode: 'TEN', egyptian: { discount: 600 } });
  assert.ok(withCode.includes('<span>كود الخصم TEN</span><span class="tabular-nums">− 280 ج.م'), withCode);
});

test('ON without an ID: the shown price stands, with no Egyptian rows', { skip }, () => {
  const html = render.renderRows({ ...base, basePrice: 3400, itemPrice: 3400, listPrice: 3400, finalAmount: 2890 });
  assert.ok(!html.includes('المصري'));
  assert.ok(!html.includes('line-through'));
});

const line = { open: false, value: '', applied: null, message: '', loading: false, currencySymbol: 'ج.م', onOpen() {}, onChange() {}, onApply() {}, onClear() {} };

test('the national-ID line: an invitation, then one labelled input, a gentle message, and the applied note', { skip }, () => {
  assert.ok(render.renderLine(line).includes('مصري؟ اكتب الرقم القومي وخد سعر المصريين'));
  const open = render.renderLine({ ...line, open: true, value: '123', message: 'الرقم القومي لازم يكون 14 رقم' });
  assert.ok(open.includes('<label for="egyptian-national-id"'), open);
  assert.ok(open.includes('الرقم القومي (14 رقم)</label>'), open);
  assert.ok(open.includes('aria-describedby="egyptian-national-id-msg"'), open);
  assert.ok(open.includes('role="status"'), open);
  assert.ok(open.includes('الرقم القومي لازم يكون 14 رقم</p>'), open);
  const applied = render.renderLine({ ...line, applied: { price: 2800, masked: '***********567', auto: false } });
  assert.ok(applied.includes('2800 ج.م'), applied);
  assert.ok(applied.includes('***********567'), applied);
  assert.ok(applied.includes('إلغاء'), applied);
  const auto = render.renderLine({ ...line, applied: { price: 2800, masked: '', auto: true } });
  assert.ok(auto.includes('من بيانات حسابك'), auto);
  assert.ok(!auto.includes('إلغاء'), auto);
});
