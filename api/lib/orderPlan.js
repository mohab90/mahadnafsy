'use strict';

// «قسط» at the site's checkout: the order's amount is the first instalment —
// 25% of the plan's total (lib/enrollmentPricing.js) — and checkout-intent
// writes the plan into the order's notes. Confirming the order, by card, by
// receipt or by hand, booked that first instalment as the whole price: no
// instalment flag, the instalment as the agreed price, full access. The client
// read as paid in full with three quarters of the plan never owed. Raised by an
// outside review on 7 Oct 2026.

const { resolvePaymentAccess, accessModeOf, paidRatioOf } = require('./paymentEntitlementAccess');

/** What the order is paying towards: the plan's total for an instalment, else its own amount. */
function orderPlan(notes, amount) {
  let parsed = {};
  try { parsed = (typeof notes === 'string' ? JSON.parse(notes || '{}') : notes) || {}; } catch { parsed = {}; }
  const total = Number(parsed.planTotal) || 0;
  const paying = Number(amount) || 0;
  const installment = parsed.payMode === 'installment' && total > paying;
  return { installment, expected: installment ? total : paying };
}

/**
 * The access a payment opens: full, or the share of the plan paid so far, the
 * way the desk grants an instalment (routes/subscriber-payments.js).
 */
async function planAccess(db, { plan, tenantId, subscriberId, courseId = null, bundleId = null, paymentId, amount, currency }) {
  if (!plan.installment) return { accessType: 'full', paidRatio: null };
  const resolved = await resolvePaymentAccess({
    db, tenantId, subscriberId, courseId, bundleId,
    currentPaymentId: paymentId, currentAmount: amount, currency, expectedAmount: plan.expected,
  });
  return { accessType: accessModeOf(resolved), paidRatio: paidRatioOf(resolved) };
}

module.exports = { orderPlan, planAccess };
