'use strict';
/**
 * The rule an item's instalment plans follow (lib/planFollowsMoney.js followMoney), on plans small enough to work out by hand. What is left on the item is
 * what its open instalments come to: a payment pays the earliest; a plan that asked for everything left keeps asking for exactly that; no plan asks for more.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { followMoney, shapeOf, columnsOf } = require('../lib/planFollowsMoney');

const TODAY = '2026-11-08';
const plan = (amounts, { due = amounts.map((_, i) => `2026-1${i}-01`), paid = [], partial = [], id = 'p1' } = {}) => shapeOf({
  id, installments_count: amounts.length, total_amount: amounts.reduce((a, b) => a + b, 0),
  installment_amounts: JSON.stringify(amounts), due_dates: JSON.stringify(due),
  paid_dates: JSON.stringify(amounts.map((_, i) => paid[i] || null)), paid_amounts: JSON.stringify(amounts.map((_, i) => partial[i] ?? null)),
  payment_ids: JSON.stringify(amounts.map(() => null)),
});
const read = shape => { const c = columnsOf(shape); return { amounts: JSON.parse(c.installment_amounts), paid: JSON.parse(c.paid_dates), ids: JSON.parse(c.payment_ids), total: c.total_amount, status: c.status }; };

test('a lower price comes off the last instalments; what is late stays owed', () => {
  const shape = plan([1000, 1000, 1000]);
  assert.equal(followMoney([shape], { remaining: 1500, before: 3000, today: TODAY }), true);
  assert.deepEqual(read(shape).amounts, [1000, 500], 'the last one dropped, the second halved');
  assert.equal(read(shape).total, 1500);
});

test('a higher price is added to the last open instalment of a plan that asked for everything left', () => {
  const shape = plan([1000, 1000]);
  followMoney([shape], { remaining: 2600, before: 2000, today: TODAY });
  assert.deepEqual(read(shape).amounts, [1000, 1600]);
});

test('a plan for part of what is left keeps its amounts when the price rises, and when it falls without reaching it', () => {
  const shape = plan([500, 500]);
  assert.equal(followMoney([shape], { remaining: 3000, before: 2500, today: TODAY }), false);
  assert.equal(followMoney([shape], { remaining: 1200, before: 2500, today: TODAY }), false);
  assert.deepEqual(read(shape).amounts, [500, 500]);
});

test('a payment pays the earliest open instalments, the part over one going to the next, and a part stays on the instalment', () => {
  const shape = plan([1000, 1000, 1000]);
  followMoney([shape], { remaining: 1500, before: 3000, payment: { id: 'pay-9', amount: 1500, day: TODAY }, today: TODAY });
  const now = read(shape);
  assert.deepEqual(now.paid, [TODAY, null, null]);
  assert.deepEqual(now.ids, ['pay-9', null, null]);
  assert.deepEqual(JSON.parse(columnsOf(shape).paid_amounts), [1000, 500, null], '500 of the second is paid, 500 of it still due');
  assert.deepEqual(now.amounts, [1000, 1000, 1000]);
});

test('an instalment brought to nothing is dropped; one partly paid is closed at its part; a plan with nothing open is completed', () => {
  const shape = plan([1000, 1000], { partial: [300, null] });
  followMoney([shape], { remaining: 0, before: 1700, today: TODAY });
  const now = read(shape);
  assert.deepEqual(now.amounts, [300], 'the second dropped; the first closed at the 300 paid on it');
  assert.deepEqual(now.paid, [TODAY]);
  assert.equal(now.status, 'completed');
});

test('a paid instalment is never touched, and an earlier due date is paid first across two plans', () => {
  const older = plan([1000, 1000], { id: 'a', due: ['2026-12-01', '2027-01-01'], paid: ['2026-10-01'] });
  const newer = plan([1000], { id: 'b', due: ['2026-11-01'] });
  followMoney([older, newer], { remaining: 1000, before: 2000, payment: { id: 'pay-1', amount: 1000, day: TODAY }, today: TODAY });
  assert.deepEqual(read(newer).ids, ['pay-1'], 'the one due first');
  assert.deepEqual(read(older).paid, ['2026-10-01', null]);
  assert.deepEqual(read(older).amounts, [1000, 1000]);
});

test('amounts are added in piastres: thirds of a price never leave a stray piastre', () => {
  const shape = plan([333.33, 333.33, 333.34]);
  followMoney([shape], { remaining: 900.01, before: 1000, today: TODAY });
  assert.equal(read(shape).total, 900.01);
});
