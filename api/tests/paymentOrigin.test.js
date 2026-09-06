'use strict';
// Three different events land in the payments table and every screen that
// listed them drew all three the same way: the gateway taking a card, a
// customer's receipt being approved, and a staff member typing a payment in.
// The third is the common one — 195 of 308 rows — and asserts a payment
// happened rather than being evidence that it did. Telling them apart on screen
// is what «الدفعات اللي بتتسجل من السيستم لازم يظهر ان دا من السيستم» asked for.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN = path.join(__dirname, '..', '..', 'admin');
const read = rel => fs.readFileSync(path.join(ADMIN, ...rel.split('/')), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// The real function is lifted out and run rather than restated, so a rewrite of
// the rules fails here instead of passing against a stale copy.
function loadOrigin() {
  const src = read('lib/paymentOrigin.ts');
  const body = src.slice(src.indexOf('export function paymentOrigin'));
  const js = body.slice(0, body.indexOf('\n}') + 2)
    .replace('export function paymentOrigin(payment: OriginInput): PaymentOrigin', 'function paymentOrigin(payment)');
  // eslint-disable-next-line no-new-func
  return new Function(`${js}\nreturn paymentOrigin;`)();
}
const paymentOrigin = loadOrigin();

test('a gateway payment reads as online', () => {
  assert.equal(paymentOrigin({ source: 'paymob' }), 'online');
  assert.equal(paymentOrigin({ source: 'web' }), 'online');
  // public-orders.js writes this method with the paymob source; either alone is enough.
  assert.equal(paymentOrigin({ paymentMethod: 'online_paymob' }), 'online');
  assert.equal(paymentOrigin({ source: 'PAYMOB' }), 'online');
});

test('an approved customer receipt is its own thing', () => {
  // payment-proofs.js writes manual_transfer: the customer sent it, but a
  // person on the desk decided it was real. Neither online nor typed in.
  assert.equal(paymentOrigin({ source: 'manual_transfer' }), 'receipt');
});

test('everything a member of staff typed reads as recorded in the system', () => {
  for (const source of ['staff', 'reception', 'daqqi', 'system', 'lead_conversion']) {
    assert.equal(paymentOrigin({ source }), 'manual');
  }
});

test('a row with no source at all is not guessed to be online', () => {
  // 105 rows on production predate the column. Calling an unknown row "online"
  // would restore the confusion this exists to remove, so it claims the least.
  assert.equal(paymentOrigin({}), 'manual');
  assert.equal(paymentOrigin({ source: null }), 'manual');
  assert.equal(paymentOrigin({ source: '' }), 'manual');
  assert.equal(paymentOrigin({ source: 'something_new' }), 'manual');
});

test('every origin has a label and a colour', () => {
  const src = read('lib/paymentOrigin.ts');
  for (const origin of ['online', 'receipt', 'manual']) {
    assert.match(src, new RegExp(`${origin}: \{`), `${origin} needs a label`);
  }
  assert.match(src, /PAYMENT_ORIGIN_CLASS/);
  assert.match(src, /تسجيل من النظام/);
  assert.match(src, /دفع أونلاين/);
});

test('the screens that list payments show it', () => {
  const orders = codeOnly(read('pages/dashboard/tabs/OrdersTab.tsx'));
  assert.match(orders, /import \{ paymentOrigin, PAYMENT_ORIGIN, PAYMENT_ORIGIN_CLASS \}/);
  assert.equal((orders.match(/PAYMENT_ORIGIN\[/g) || []).length >= 4, true, 'both payment tables should render the badge');
  assert.equal((orders.match(/>المصدر</g) || []).length, 2, 'both payment tables need the column header');
});

test('the review panel reads the shared rule instead of its own map', () => {
  const panel = codeOnly(read('pages/dashboard/tabs/financial/PaymentReviewPanel.tsx'));
  assert.match(panel, /const origin = paymentOrigin\(\{ source: src, paymentMethod: method \}\)/);
  assert.match(panel, /sourceBadgeEl\(p\.source, p\.paymentMethod\)/);
  // The old map named raw sources and drew nothing when the source was absent.
  assert.doesNotMatch(panel, /web: \['موقع'/);
  assert.doesNotMatch(panel, /if \(!src\) return null/);
});

test('the review panel can also supply a missing method when confirming', () => {
  // It confirms payments too, so the API's rule would have dead-ended here
  // exactly as it would have in the orders queue.
  const panel = codeOnly(read('pages/dashboard/tabs/financial/PaymentReviewPanel.tsx'));
  assert.match(panel, /approveMethod\[p\.id\]/);
  assert.match(panel, /paymentMethod: approveMethod\[p\.id\]/);
  assert.match(panel, /disabled=\{reviewActionLoading === p\.id \|\| \(!String\(p\.paymentMethod \|\| ''\)\.trim\(\) && !approveMethod\[p\.id\]\)\}/);
});
