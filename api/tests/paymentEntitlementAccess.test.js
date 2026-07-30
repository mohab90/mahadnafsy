'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePaymentAccess } = require('../lib/paymentEntitlementAccess');

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
  assert.equal(await resolvePaymentAccess({ ...input, db }), 'limited');
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
  assert.equal(await resolvePaymentAccess({ ...input, db, expectedAmount: null }), 'limited');
});
