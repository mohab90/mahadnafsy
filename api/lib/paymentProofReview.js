'use strict';

const DEFAULT_POLICY = Object.freeze({
  slaHours: 4,
  dualApprovalThresholds: Object.freeze({ EGP: 50000, SAR: 4000, USD: 2000 }),
});

function normalizePolicy(value = {}) {
  const thresholds = value?.dualApprovalThresholds || {};
  const positive = (candidate, fallback) => {
    const number = Number(candidate);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  return {
    slaHours: Math.min(48, Math.max(1, Math.round(positive(value?.slaHours, DEFAULT_POLICY.slaHours)))),
    dualApprovalThresholds: {
      EGP: positive(thresholds.EGP, DEFAULT_POLICY.dualApprovalThresholds.EGP),
      SAR: positive(thresholds.SAR, DEFAULT_POLICY.dualApprovalThresholds.SAR),
      USD: positive(thresholds.USD, DEFAULT_POLICY.dualApprovalThresholds.USD),
    },
  };
}

function classifyPaymentProof({ amount, currency, policy }) {
  const normalized = normalizePolicy(policy);
  const code = String(currency || 'EGP').toUpperCase();
  const threshold = normalized.dualApprovalThresholds[code];
  if (!threshold) throw new Error('Unsupported payment proof currency');
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('Invalid payment proof amount');
  return {
    riskLevel: numericAmount >= threshold ? 'high' : 'standard',
    secondReviewRequired: numericAmount >= threshold,
    slaHours: normalized.slaHours,
  };
}

function paymentProofReviewStep({ action, secondReviewRequired, firstReviewerId, actorId }) {
  if (!['approve', 'reject'].includes(action)) throw new Error('Invalid payment proof review action');
  if (action === 'reject') return 'final_reject';
  if (!secondReviewRequired) return 'final_approve';
  if (!firstReviewerId) return 'first_approve';
  if (String(firstReviewerId) === String(actorId)) {
    const error = new Error('A different reviewer must provide the second approval');
    error.status = 409;
    error.code = 'SECOND_REVIEWER_REQUIRED';
    throw error;
  }
  return 'final_approve';
}

module.exports = {
  DEFAULT_POLICY,
  classifyPaymentProof,
  normalizePolicy,
  paymentProofReviewStep,
};
