'use strict';
// Behaviour, not source text: the money fixes from the 20–21 Oct 2026 review.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { chargeStillMatches } = require('../lib/paymobGateway');
const { paymentPeriod } = require('../lib/paymentCompensation');
const { resolvePaymentAccess } = require('../lib/paymentEntitlementAccess');

test('a fixed EGP charge stands only while it is still the order at its rate', () => {
  // 465 SAR at 13 EGP = 6,045 EGP.
  assert.equal(chargeStillMatches({ amount: 465, charge_amount: 6045, charge_fx_rate: 13 }), true);
  // The same order switched to 1,700 SAR cash: the old figure no longer pays it.
  assert.equal(chargeStillMatches({ amount: 1700, charge_amount: 6045, charge_fx_rate: 13 }), false);
  assert.equal(chargeStillMatches({ amount: 465, charge_amount: 6045, charge_fx_rate: null }), false);
  // Rounding of the stored rate is not a change.
  assert.equal(chargeStillMatches({ amount: 333, charge_amount: 4329.01, charge_fx_rate: 13.0000300 }), true);
});

test('a commission counts in the Cairo month of its payment, given as the driver returns it', () => {
  // A desk payment of 30 Sep (stored at midnight) is September.
  assert.deepEqual(paymentPeriod(new Date('2026-09-30T00:00:00Z')), { year: 2026, month: 9 });
  // An approval at 01:30 Cairo on 1 Oct, stored as 30 Sep 22:30 UTC, is October in Cairo.
  assert.deepEqual(paymentPeriod(new Date('2026-09-30T22:30:00Z')), { year: 2026, month: 10 });
  assert.deepEqual(paymentPeriod('2026-08-14'), { year: 2026, month: 8 });
});

test('money paid before the system counts towards opening the course', async () => {
  const db = {
    async query(sql) {
      if (/FROM payments/.test(sql)) return [[]];
      if (/FROM subscribers/.test(sql)) return [[{ crm_json: JSON.stringify({ priorPaid: { 'c-1': 3000 } }) }]];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  // 3,000 on the old sheet + 2,000 at the desk = the whole 5,000.
  const full = await resolvePaymentAccess({
    db, tenantId: 't', subscriberId: 's', courseId: 'c-1', currentPaymentId: 'p', currentAmount: 2000, currency: 'EGP', expectedAmount: 5000,
  });
  assert.equal(full, 'full');
  // A dollar payment does not add pounds from the sheet.
  const usd = await resolvePaymentAccess({
    db, tenantId: 't', subscriberId: 's', courseId: 'c-1', currentPaymentId: 'p', currentAmount: 100, currency: 'USD', expectedAmount: 300,
  });
  assert.equal(usd.mode, 'limited');
});
