'use strict';

// The checks that stand between a Paymob callback and money being credited.
//
// Four things have to hold, and the first three were established by earlier
// fixes — this pins them so they cannot quietly come back:
//
//   1. the signature is verified, with a timing-safe compare and SHA-512 over
//      Paymob's own field order;
//   2. `success` is true — a declined transaction credits nothing;
//   3. the price comes from the catalogue, at both public checkout endpoints,
//      because neither requires a login and both used to take it from the body;
//   4. the captured amount and currency match the order (added here), so a
//      partial capture is not booked as a full one and a drift between
//      reservation and capture is refused rather than absorbed.
//
// And one state rule: an order that is already paid does not walk backwards to
// pending because somebody re-posted its id.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const API = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');

const {
  verifyPaymobHmac, buildPaymobHmacPayload, PAYMOB_HMAC_FIELDS, paymobMerchantOrderId,
} = require('../lib/paymobHmac');
const { resolveCatalogPrice, priceMatches } = require('../lib/catalogPrice');

const SECRET = 'test-hmac-secret';
const signedCallback = (overrides = {}) => {
  const params = {
    amount_cents: 500000, created_at: '2026-09-14T00:00:00Z', currency: 'EGP',
    error_occured: false, has_parent_transaction: false, id: 987654,
    integration_id: 1234, is_3d_secure: true, is_auth: false, is_capture: false,
    is_refunded: false, is_standalone_payment: true, is_voided: false,
    order: { id: 555, merchant_order_id: 'order-abc' }, owner: 42, pending: false,
    source_data: { pan: '1234', sub_type: 'MasterCard', type: 'card' },
    success: true, ...overrides,
  };
  params.hmac = crypto.createHmac('sha512', SECRET)
    .update(buildPaymobHmacPayload(params)).digest('hex');
  return params;
};

test('a genuine signed callback verifies', () => {
  assert.equal(verifyPaymobHmac(signedCallback(), SECRET), true);
});

test('any tampering with a signed field invalidates it', () => {
  // The whole point: the amount is inside the signature.
  for (const [field, value] of [
    ['amount_cents', 100], ['currency', 'USD'], ['success', false], ['id', 1],
  ]) {
    const params = signedCallback();
    params[field] = value;
    assert.equal(verifyPaymobHmac(params, SECRET), false,
      `${field} could be changed without breaking the signature`);
  }
  // A forged hmac of the right shape.
  const forged = signedCallback();
  forged.hmac = 'a'.repeat(128);
  assert.equal(verifyPaymobHmac(forged, SECRET), false);
  // The wrong secret.
  assert.equal(verifyPaymobHmac(signedCallback(), 'not-the-secret'), false);
  // No secret configured at all must fail closed, not open.
  assert.equal(verifyPaymobHmac(signedCallback(), ''), false);
  assert.equal(verifyPaymobHmac(signedCallback(), undefined), false);
  // A missing hmac is not a pass.
  const bare = signedCallback();
  delete bare.hmac;
  assert.equal(verifyPaymobHmac(bare, SECRET), false);
});

test('the signature covers Paymob\'s own field list, in order', () => {
  assert.equal(PAYMOB_HMAC_FIELDS.length, 20);
  assert.equal(PAYMOB_HMAC_FIELDS[0], 'amount_cents');
  assert.ok(PAYMOB_HMAC_FIELDS.includes('currency'));
  assert.ok(PAYMOB_HMAC_FIELDS.includes('success'));
  assert.ok(PAYMOB_HMAC_FIELDS.includes('order'));
  // SHA-512 and a timing-safe compare, not == on strings.
  const src = read('lib/paymobHmac.js');
  assert.match(src, /createHmac\('sha512'/);
  assert.match(src, /timingSafeEqual/);
});

test('the merchant order id survives the per-attempt suffix', () => {
  // The reference sent to Paymob is `${orderId}~${base36}` because Paymob
  // refuses a reference it has seen before; the order id is everything before
  // the tilde, and no UUID contains one.
  assert.equal(paymobMerchantOrderId({ merchant_order_id: 'order-abc~m1x2y3' }), 'order-abc');
  assert.equal(paymobMerchantOrderId({ order: { merchant_order_id: 'order-abc' } }), 'order-abc');
});

test('a declined transaction credits nothing', () => {
  const src = read('routes/public-orders.js');
  // Both entry points gate on success before finalising.
  assert.match(src, /if \(!paymobSuccess\(params\)\) return res\.json\(\{ ok: true, verified: true, paid: false \}\)/);
  assert.match(src, /if \(paymobSuccess\(params\)\) \{[\s\S]{0,200}?finalisePaymobOrder/);
  // And success is read strictly, not truthily — 'false' is a string here.
  assert.match(src, /String\(params\.success \?\? params\.obj\?\.success \?\? ''\)\.toLowerCase\(\) === 'true'/);
});

test('the captured amount and currency have to match the order', () => {
  const src = read('routes/public-orders.js');
  assert.match(src, /capture\.amountCents !== expectedCents/,
    'the webhook credits the order without checking what was captured');
  assert.match(src, /return \{ found: true, amountMismatch: true \}/);
  assert.match(src, /return \{ found: true, currencyMismatch: true \}/);
  // Both call sites pass it.
  const calls = src.match(/finalisePaymobOrder\(merchantOrderId, paymobTransactionId\(params\)[^)]*\)/g) || [];
  assert.equal(calls.length, 2, 'expected exactly two finalise call sites');
  for (const call of calls) {
    assert.ok(call.includes('paymobCapture(params)'),
      'a finalise call site does not pass the captured amount: ' + call);
  }
});

test('an order that is already paid does not walk back to pending', () => {
  const src = read('routes/public-orders.js');
  assert.match(src, /ORDER_ALREADY_PAID/);
  // Belt and braces: the upsert itself refuses too, so a race cannot slip
  // between the check and the write.
  assert.match(src, /status\s*=\s*IF\(status='paid', status,\s*'pending'\)/);
  assert.ok(!/ON DUPLICATE KEY UPDATE status='pending'/.test(src),
    'the unconditional pending upsert is back');
});

test('the catalogue decides the price, not the caller', () => {
  const src = read('routes/public-orders.js');
  // reserve: refuses a mismatch rather than silently correcting it.
  assert.match(src, /PRICE_MISMATCH/);
  assert.match(src, /!priceMatches\(amount, catalogPrice\)/);
  // paymob-init: charges from the reserved row, never from the body.
  assert.match(src, /SELECT amount, currency FROM orders WHERE id=\? AND tenant_id=\?/);
  assert.ok(!/const \{[^}]*\bamount\b[^}]*\} = req\.body[\s\S]{0,400}?paymobIntention/.test(src),
    'paymob-init reads an amount from the request body again');

  // A zero or missing catalogue price is not "free".
  assert.equal(priceMatches(2799.999999999999, 2800), true);
  assert.equal(priceMatches(1, 2800), false);
  assert.equal(priceMatches('abc', 2800), false);
  assert.equal(priceMatches(2800, null), false);
});

test('resolveCatalogPrice never prices a row it cannot find', async () => {
  const noRow = { query: async () => [[]] };
  const zero = { query: async () => [[{ price: 0 }]] };
  const real = { query: async () => [[{ price: 2800 }]] };
  assert.equal(await resolveCatalogPrice(noRow, { type: 'course', itemId: 'x' }), null);
  assert.equal(await resolveCatalogPrice(zero, { type: 'course', itemId: 'x' }), null,
    'a zero price was treated as a real price');
  assert.equal(await resolveCatalogPrice(real, { type: 'course', itemId: 'x' }), 2800);
  // An unknown currency has no column, so it has no say.
  assert.equal(await resolveCatalogPrice(real, { type: 'course', itemId: 'x', currency: 'XXX' }), null);
  // A type with no catalogue table.
  assert.equal(await resolveCatalogPrice(real, { type: 'consultation', itemId: 'x' }), null);
});

test('course access is granted from the database, never from the order body', () => {
  const src = read('routes/public-orders.js');
  // bundleCourseIds arrives in the request and is stored in notes; the grant
  // must read the bundle's courses from the bundle, not from that.
  assert.match(src, /SECURITY: always fetch bundle courses from DB/);
  const grantBlock = src.slice(src.indexOf('if (orderType === \'bundle\')'),
    src.indexOf('for (const cid of courseIds)'));
  assert.ok(!/extra\.bundleCourseIds/.test(grantBlock),
    'the grant reads the caller-supplied course list');
  // And only a course or bundle order grants anything at all.
  assert.match(src, /if \(\(orderType === 'course' \|\| orderType === 'bundle'\) && sub\)/);
});
