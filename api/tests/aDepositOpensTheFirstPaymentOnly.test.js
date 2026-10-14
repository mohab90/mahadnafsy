'use strict';

// «لما العميل بيتحول من محتمل الي اونلاين ليه بيتفتح له الفيديوهات كاملة المفروض دا
// حجز جزئي يظهر الفيديوهات اول دفعة فقط» (13 Oct 2026). Only instalments were
// measured against the course's price; a booking that paid a deposit was granted
// the whole course.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolvePaymentAccess, accessModeOf, paidRatioOf } = require('../lib/paymentEntitlementAccess');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

const dbWith = priorRows => ({ query: async () => [priorRows] });
const base = { tenantId: 't1', subscriberId: 's1', courseId: 'c1', currentPaymentId: 'p-new', currency: 'EGP' };

test('a deposit on a new booking opens a share of the course, in proportion', async () => {
  const resolved = await resolvePaymentAccess({ ...base, db: dbWith([]), currentAmount: 1000, expectedAmount: 4000, lenient: true });
  assert.equal(accessModeOf(resolved), 'limited');
  assert.equal(paidRatioOf(resolved), 0.25);
});

test('a booking paid in full, or beyond, opens the whole course', async () => {
  assert.equal(await resolvePaymentAccess({ ...base, db: dbWith([]), currentAmount: 4000, expectedAmount: 4000, lenient: true }), 'full');
  assert.equal(await resolvePaymentAccess({ ...base, db: dbWith([]), currentAmount: 5000, expectedAmount: 4000, lenient: true }), 'full');
});

test('the deposit and the instalments that follow add up, so the grant grows and finally opens', async () => {
  const afterDeposit = await resolvePaymentAccess({
    ...base, db: dbWith([{ currency: 'EGP', total_paid: 1000, min_expected: 4000, max_expected: 4000 }]),
    currentAmount: 1000, expectedAmount: 4000,
  });
  assert.equal(paidRatioOf(afterDeposit), 0.5);
  const last = await resolvePaymentAccess({
    ...base, db: dbWith([{ currency: 'EGP', total_paid: 3000, min_expected: 4000, max_expected: 4000 }]),
    currentAmount: 1000, expectedAmount: 4000,
  });
  assert.equal(last, 'full');
});

test('a booking is not refused for an older row in another currency or at another price', async () => {
  const mixed = [{ currency: 'USD', total_paid: 100, min_expected: 90, max_expected: 90 }, { currency: 'EGP', total_paid: 500, min_expected: 3000, max_expected: 3000 }];
  const resolved = await resolvePaymentAccess({ ...base, db: dbWith(mixed), currentAmount: 500, expectedAmount: 4000, lenient: true });
  assert.equal(paidRatioOf(resolved), 0.25, 'only the same-currency money counts: 500 + 500 of 4000');
  // An instalment is still held to the strict rules.
  await assert.rejects(resolvePaymentAccess({ ...base, db: dbWith(mixed), currentAmount: 500, expectedAmount: 4000 }), error => error.code === 'INSTALLMENT_CURRENCY_MISMATCH');
  await assert.rejects(
    resolvePaymentAccess({ ...base, db: dbWith([{ currency: 'EGP', total_paid: 500, min_expected: 3000, max_expected: 3000 }]), currentAmount: 500, expectedAmount: 4000 }),
    error => error.code === 'INSTALLMENT_EXPECTED_MISMATCH');
});

test('a booking whose price is unknown is not measured', async () => {
  // resolvePaymentAccess answers 'limited' for a missing price; the route only asks when there is one.
  const route = read('api/routes/subscriber-payments.js');
  assert.match(route, /if \(payment\.isInstallment \|\| Number\(resolvedExpected\) > 0\) \{/);
  assert.match(route, /lenient: !payment\.isInstallment,/);
});

test('approving a pending booking measures it the same way', () => {
  const approval = read('api/routes/core/financepay.js');
  assert.match(approval, /if \(Number\(payment\.course_expected\) > 0\) \{/);
  assert.match(approval, /lenient: !payment\.is_installment,/);
});
