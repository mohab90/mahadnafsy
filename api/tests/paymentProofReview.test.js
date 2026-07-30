'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyPaymentProof,
  normalizePolicy,
  paymentProofReviewStep,
} = require('../lib/paymentProofReview');

test('payment proof policy bounds SLA and classifies risk per settlement currency', () => {
  assert.equal(normalizePolicy({ slaHours: 999 }).slaHours, 48);
  assert.deepEqual(classifyPaymentProof({ amount: 49999, currency: 'EGP' }), {
    riskLevel: 'standard', secondReviewRequired: false, slaHours: 4,
  });
  assert.equal(classifyPaymentProof({ amount: 50000, currency: 'EGP' }).secondReviewRequired, true);
  assert.equal(classifyPaymentProof({ amount: 4000, currency: 'SAR' }).secondReviewRequired, true);
  assert.equal(classifyPaymentProof({ amount: 2000, currency: 'USD' }).secondReviewRequired, true);
});

test('sensitive manual proof requires two distinct reviewers while rejection stays immediate', () => {
  assert.equal(paymentProofReviewStep({
    action: 'approve', secondReviewRequired: true, firstReviewerId: null, actorId: 'a',
  }), 'first_approve');
  assert.throws(() => paymentProofReviewStep({
    action: 'approve', secondReviewRequired: true, firstReviewerId: 'a', actorId: 'a',
  }), /different reviewer/i);
  assert.equal(paymentProofReviewStep({
    action: 'approve', secondReviewRequired: true, firstReviewerId: 'a', actorId: 'b',
  }), 'final_approve');
  assert.equal(paymentProofReviewStep({
    action: 'reject', secondReviewRequired: true, firstReviewerId: 'a', actorId: 'a',
  }), 'final_reject');
});
