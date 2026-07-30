'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentPeriod, recordPaymentCompensation } = require('../lib/paymentCompensation');

function compensationDb(payment, { ruleRate = 5, instructorShare = 10 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM payments p')) return [[payment]];
      if (sql.includes('FROM commission_rules')) {
        return [[ruleRate ? { id: 'rule-1', percentage_value: ruleRate } : null]];
      }
      if (sql.includes('SELECT commission_rate FROM staff')) return [[{ commission_rate: 0 }]];
      if (sql.includes('LEFT JOIN instructor_rates')) {
        return [[{ instructor_id: 'instructor-1', revenue_share_pct: instructorShare }]];
      }
      if (sql.includes('INSERT INTO crm_commissions') || sql.includes('INSERT INTO instructor_fees')) return [{}];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

const paidCourse = {
  id: 'pay-1',
  subscriber_id: 'sub-1',
  course_id: 'course-1',
  payment_type: 'COURSE',
  amount: 100,
  amount_egp: 5000,
  currency: 'USD',
  is_installment: 0,
  date: '2026-07-10',
  staff_id: null,
  branch_id: 'branch-online-abroad',
  assigned_sales_id: 'sales-1',
};

test('payment compensation uses the immutable EGP snapshot for commission and instructor share', async () => {
  const db = compensationDb(paidCourse);
  await recordPaymentCompensation({ paymentId: 'pay-1', tenantId: 'tenant-a', actor: 'finance-1' }, db);

  const commission = db.calls.find(call => call.sql.includes('INSERT INTO crm_commissions'));
  assert.ok(commission);
  assert.equal(commission.params[8], 5000);
  assert.equal(commission.params[9], 250);
  assert.equal(commission.params[11], 7);
  assert.equal(commission.params[12], 2026);

  const fee = db.calls.find(call => call.sql.includes('INSERT INTO instructor_fees'));
  assert.ok(fee);
  assert.equal(fee.params[4], 'pay-1', 'instructor fee must be idempotently linked to its source payment');
  assert.equal(fee.params[5], 500);
  assert.match(fee.sql, /ON DUPLICATE KEY UPDATE/);
});

test('payment compensation fails closed before writing when the EGP snapshot is absent', async () => {
  const db = compensationDb({ ...paidCourse, amount_egp: null });
  await assert.rejects(
    () => recordPaymentCompensation({ paymentId: 'pay-1', tenantId: 'tenant-a' }, db),
    /EGP snapshot/i,
  );
  assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO crm_commissions')), false);
});

test('payment period follows the payment date instead of the server current month', () => {
  assert.deepEqual(paymentPeriod('2025-12-31'), { year: 2025, month: 12 });
});
