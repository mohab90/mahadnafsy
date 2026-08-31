'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePaymentAccess, accessModeOf, paidRatioOf } = require('../lib/paymentEntitlementAccess');

const input = {
  tenantId: 'tenant-a',
  subscriberId: 'sub-1',
  courseId: 'course-1',
  currentPaymentId: 'pay-current',
  currentAmount: 400,
  currency: 'EGP',
  expectedAmount: 1000,
};

test('installment access counts the current payment exactly once', async () => {
  const db = { query: async () => [[{ currency: 'EGP', total_paid: 600, min_expected: 1000, max_expected: 1000 }]] };
  assert.equal(await resolvePaymentAccess({ ...input, db }), 'full');
});

test('installment access stays limited below the expected total', async () => {
  const db = { query: async () => [[{ currency: 'EGP', total_paid: 599.99, min_expected: 1000, max_expected: 1000 }]] };
  assert.equal(accessModeOf(await resolvePaymentAccess({ ...input, db })), 'limited');
});

test('installment access fails closed when currencies are mixed', async () => {
  const db = { query: async () => [[{ currency: 'USD', total_paid: 20, min_expected: 1000, max_expected: 1000 }]] };
  await assert.rejects(() => resolvePaymentAccess({ ...input, db }), error => error.code === 'INSTALLMENT_CURRENCY_MISMATCH');
});

test('installment access fails closed when the expected total changes', async () => {
  const db = { query: async () => [[{ currency: 'EGP', total_paid: 600, min_expected: 900, max_expected: 900 }]] };
  await assert.rejects(() => resolvePaymentAccess({ ...input, db }), error => error.code === 'INSTALLMENT_EXPECTED_MISMATCH');
});

test('installment access without a trusted expected total remains limited', async () => {
  const db = { query: async () => { throw new Error('must not query'); } };
  assert.equal(accessModeOf(await resolvePaymentAccess({ ...input, db, expectedAmount: null })), 'limited');
});

// Paying more opens more.
//
// 'limited' was binary and its floor is one lecture, so a client who had paid
// 90% of the price saw exactly what one who had paid 6% saw. Instalments are
// not the exception here — of the eight clients the reconciliation check
// flagged, every one had paid between 6% and 29%, and the desk was closing the
// gap by hand, course by course.
test('a partial payment reports how much of the price it covers', async () => {
  const db = { query: async () => [[{ currency: 'EGP', total_paid: 100, min_expected: 1000, max_expected: 1000 }]] };
  const result = await resolvePaymentAccess({ ...input, db });
  assert.equal(accessModeOf(result), 'limited');
  // 100 already paid + 400 now, against 1000.
  assert.equal(Math.round(paidRatioOf(result) * 100), 50);
});

test('the ratio rises with the payment rather than staying flat', async () => {
  const ratioFor = async (priorPaid) => {
    const db = { query: async () => [[{ currency: 'EGP', total_paid: priorPaid, min_expected: 1000, max_expected: 1000 }]] };
    return paidRatioOf(await resolvePaymentAccess({ ...input, db }));
  };
  const small = await ratioFor(0);      // 400/1000
  const large = await ratioFor(500);    // 900/1000
  assert.ok(large > small, 'paying more must open more, or the ratio is decoration');
  assert.ok(small > 0 && large < 1, 'a partial payment is strictly between nothing and everything');
});

test('full access reports no ratio, because there is nothing left to divide', async () => {
  const db = { query: async () => [[{ currency: 'EGP', total_paid: 600, min_expected: 1000, max_expected: 1000 }]] };
  const result = await resolvePaymentAccess({ ...input, db });
  assert.equal(accessModeOf(result), 'full');
  assert.equal(paidRatioOf(result), null);
});

test('the ratio never reaches 1, so it cannot be mistaken for paid in full', async () => {
  // 999.99 of 1000 is still not paid up. Rounding it to 1 would hand over the
  // whole course for the last piastre.
  const db = { query: async () => [[{ currency: 'EGP', total_paid: 599.99, min_expected: 1000, max_expected: 1000 }]] };
  const ratio = paidRatioOf(await resolvePaymentAccess({ ...input, db }));
  assert.ok(ratio < 1, `ratio ${ratio} must stay below 1 while any balance remains`);
});
