'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { nextBillingDate } = require('../lib/subscriptionBilling');

describe('subscription billing date calculation', () => {
  it('clamps a monthly renewal to the last valid day of February', () => {
    assert.equal(nextBillingDate('2025-01-31', 'monthly'), '2025-02-28');
    assert.equal(nextBillingDate('2024-01-31', 'monthly'), '2024-02-29');
  });

  it('clamps quarterly and yearly renewals without skipping a month', () => {
    assert.equal(nextBillingDate('2025-11-30', 'quarterly'), '2026-02-28');
    assert.equal(nextBillingDate('2024-02-29', 'yearly'), '2025-02-28');
  });

  it('rejects impossible dates and unsupported cycles', () => {
    assert.throws(() => nextBillingDate('2025-02-31', 'monthly'), /invalid subscription billing date/);
    assert.throws(() => nextBillingDate('2025-01-01', 'weekly'), /invalid subscription billing cycle/);
  });
});
