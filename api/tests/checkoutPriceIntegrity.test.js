'use strict';

// Both public checkout endpoints took the price from the request body.
//
// POST /api/orders/reserve wrote whatever it was given into orders.amount, and
// POST /api/payments/paymob-init handed a second client-supplied figure to
// Paymob. The webhook then read the order back, saw it unpaid, enrolled the
// customer and recorded the payment — so a 3,000 EGP course could be ordered
// for one pound and the customer would get it.
//
// Neither endpoint can require authentication: guests check out. So the price
// has to come from the catalogue, and the charge has to come from the reserved
// order rather than from a second request.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { resolveCatalogPrice, priceMatches } = require('../lib/catalogPrice');

/** A pool that answers one row. */
const stub = (row) => ({ async query() { return [row ? [row] : []]; } });

test('a course price is read from the catalogue column for its currency', async () => {
  const calls = [];
  const db = {
    async query(sql, params) { calls.push({ sql, params }); return [[{ price: 2800 }]]; },
  };
  const price = await resolveCatalogPrice(db, {
    type: 'course', itemId: 'c-1', currency: 'SAR', tenantId: 'tenant-default',
  });
  assert.strictEqual(price, 2800);
  assert.match(calls[0].sql, /price_sar/, 'the currency picks the column');
  assert.match(calls[0].sql, /FROM `courses`/);
  assert.match(calls[0].sql, /deleted_at IS NULL/, 'a deleted course has no price');
  assert.ok(calls[0].params.includes('tenant-default'), 'scoped to the tenant');
});

test('a bundle reads from the bundles table', async () => {
  const calls = [];
  const db = { async query(sql) { calls.push(sql); return [[{ price: 5000 }]]; } };
  await resolveCatalogPrice(db, { type: 'bundle', itemId: 'b-1', currency: 'EGP' });
  assert.match(calls[0], /FROM `bundles`/);
  assert.match(calls[0], /price_egp/);
});

test('a consultation has no catalogue price and says so', async () => {
  // Priced per booking, so the caller keeps its previous behaviour rather than
  // being handed a wrong number.
  assert.strictEqual(await resolveCatalogPrice(stub(null), { type: 'consultation', itemId: 'x' }), null);
});

test('an unpriced or missing row returns null rather than zero', async () => {
  // A zero in the catalogue is a row nobody has priced, not a free course.
  for (const price of [0, null, undefined, -5, 'abc']) {
    assert.strictEqual(await resolveCatalogPrice(stub({ price }), { type: 'course', itemId: 'c-1' }), null);
  }
  assert.strictEqual(await resolveCatalogPrice(stub(null), { type: 'course', itemId: 'missing' }), null);
});

test('an unknown currency does not fall back to another one', async () => {
  // Falling back to EGP would charge a Saudi customer the Egyptian price.
  assert.strictEqual(await resolveCatalogPrice(stub({ price: 100 }), { type: 'course', itemId: 'c', currency: 'GBP' }), null);
});

test('comparison tolerates float noise but not a real difference', () => {
  assert.strictEqual(priceMatches(2800, 2800), true);
  assert.strictEqual(priceMatches(2799.999999999999, 2800), true);
  assert.strictEqual(priceMatches('2800', 2800), true);
  assert.strictEqual(priceMatches(2799, 2800), false);
  assert.strictEqual(priceMatches(1, 3000), false, 'the exploit amount');
  assert.strictEqual(priceMatches(NaN, 2800), false);
  assert.strictEqual(priceMatches(undefined, 2800), false);
});

test('neither endpoint takes the charged amount from the request body', () => {
  const route = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'public-orders.js'), 'utf8');

  // paymob-init must read the amount off the reserved order.
  const init = route.slice(route.indexOf("'/api/payments/paymob-init'"));
  const initBody = init.slice(0, init.indexOf('router.post', 10));
  assert.doesNotMatch(initBody, /const \{[^}]*\bamount\b[^}]*\} = req\.body/,
    'paymob-init must not destructure an amount from the body');
  assert.match(initBody, /FROM orders WHERE id=\?/,
    'paymob-init should charge what was reserved');

  // reserve must check the catalogue.
  const reserve = route.slice(route.indexOf("'/api/orders/reserve'"));
  const reserveBody = reserve.slice(0, reserve.indexOf('router.post', 10));
  assert.match(reserveBody, /resolveCatalogPrice/, 'reserve should consult the catalogue');
  assert.match(reserveBody, /PRICE_MISMATCH/, 'and refuse a price that does not match');
});
