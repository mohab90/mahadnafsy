'use strict';
/**
 * Behavioral tests for lib/installmentMath.js — the core logic behind
 * confirming an installment payment (PAY-16: installment payments used to
 * only ever be written to subscribers.crm_json, never to a real payments
 * row, so they were invisible to every financial report).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyInstallmentPayment, removeInstallmentEntry } = require('../lib/installmentMath');

function samplePlan(overrides = {}) {
  return {
    installment_amounts: JSON.stringify([1000, 1000, 1000]),
    due_dates: JSON.stringify(['2026-01-01', '2026-02-01', '2026-03-01']),
    paid_dates: JSON.stringify([null, null, null]),
    payment_ids: JSON.stringify([null, null, null]),
    paid_amounts: JSON.stringify([null, null, null]),
    ...overrides,
  };
}

test('applyInstallmentPayment: marks the entry paid and stays active when more remain', () => {
  const plan = samplePlan();
  const result = applyInstallmentPayment(plan, { index: 0, paidAmount: 1000, paidDate: '2026-01-05', paymentId: 'pay-1' });
  assert.equal(result.status, 'active');
  assert.equal(result.paidCount, 1);
  assert.equal(result.paidDates[0], '2026-01-05');
  assert.equal(result.paymentIds[0], 'pay-1');
  assert.equal(result.paidAmounts[0], 1000);
  assert.equal(result.paidDates[1], null, 'must not touch other entries');
});

test('applyInstallmentPayment: transitions to completed once every entry is paid', () => {
  let plan = samplePlan();
  let r = applyInstallmentPayment(plan, { index: 0, paidAmount: 1000, paidDate: '2026-01-05', paymentId: 'pay-1' });
  plan = { ...plan, paid_dates: JSON.stringify(r.paidDates), payment_ids: JSON.stringify(r.paymentIds), paid_amounts: JSON.stringify(r.paidAmounts) };
  r = applyInstallmentPayment(plan, { index: 1, paidAmount: 1000, paidDate: '2026-02-03', paymentId: 'pay-2' });
  plan = { ...plan, paid_dates: JSON.stringify(r.paidDates), payment_ids: JSON.stringify(r.paymentIds), paid_amounts: JSON.stringify(r.paidAmounts) };
  r = applyInstallmentPayment(plan, { index: 2, paidAmount: 1000, paidDate: '2026-03-02', paymentId: 'pay-3' });
  assert.equal(r.status, 'completed');
  assert.equal(r.paidCount, 3);
});

test('applyInstallmentPayment: rejects paying the same entry twice', () => {
  const plan = samplePlan({ paid_dates: JSON.stringify(['2026-01-05', null, null]) });
  assert.throws(
    () => applyInstallmentPayment(plan, { index: 0, paidAmount: 1000, paidDate: '2026-01-06', paymentId: 'pay-x' }),
    (err) => { assert.equal(err.statusCode, 409); assert.match(err.message, /already paid/); return true; }
  );
});

test('applyInstallmentPayment: rejects an out-of-range index', () => {
  const plan = samplePlan();
  assert.throws(
    () => applyInstallmentPayment(plan, { index: 5, paidAmount: 1000, paidDate: '2026-01-05', paymentId: 'pay-1' }),
    { statusCode: 400 }
  );
});

test('applyInstallmentPayment: rejects a non-positive amount', () => {
  const plan = samplePlan();
  assert.throws(() => applyInstallmentPayment(plan, { index: 0, paidAmount: 0, paidDate: '2026-01-05', paymentId: 'p' }), { statusCode: 400 });
  assert.throws(() => applyInstallmentPayment(plan, { index: 0, paidAmount: -50, paidDate: '2026-01-05', paymentId: 'p' }), { statusCode: 400 });
});

test('applyInstallmentPayment: records a partial amount different from the scheduled amount', () => {
  const plan = samplePlan();
  const r = applyInstallmentPayment(plan, { index: 0, paidAmount: 600, paidDate: '2026-01-05', paymentId: 'pay-1' });
  assert.equal(r.paidAmounts[0], 600, 'actual collected amount must be recorded even if it differs from the scheduled amount');
  assert.equal(r.scheduledAmount, 1000, 'the originally scheduled amount is still exposed for the payments.note/course_expected field');
});

test('removeInstallmentEntry: removes an unpaid entry and recomputes count/total', () => {
  const plan = samplePlan(); // 3 entries of 1000 each
  const r = removeInstallmentEntry(plan, { index: 1 });
  assert.equal(r.installmentAmounts.length, 2);
  assert.equal(r.installmentsCount, 2);
  assert.equal(r.totalAmount, 2000);
  assert.equal(r.dueDates.length, 2);
});

test('removeInstallmentEntry: refuses to remove an entry that has already been paid', () => {
  const plan = samplePlan({ paid_dates: JSON.stringify(['2026-01-05', null, null]) });
  assert.throws(
    () => removeInstallmentEntry(plan, { index: 0 }),
    (err) => { assert.equal(err.statusCode, 409); assert.match(err.message, /already been paid/); return true; }
  );
});

test('removeInstallmentEntry: rejects an out-of-range index', () => {
  const plan = samplePlan();
  assert.throws(() => removeInstallmentEntry(plan, { index: 9 }), { statusCode: 400 });
});
