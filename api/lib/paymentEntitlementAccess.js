'use strict';

// Determines whether a paid installment may unlock full learning access.
// Installment aggregation is intentionally single-currency: mixing nominal
// amounts or changing the expected total would grant access incorrectly.
async function resolvePaymentAccess({
  db,
  tenantId,
  subscriberId,
  courseId = null,
  bundleId = null,
  currentPaymentId,
  currentAmount,
  currency,
  expectedAmount,
}) {
  const amount = Number(currentAmount);
  const expected = Number(expectedAmount);
  const normalizedCurrency = String(currency || '').toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) throw financialConflict('Invalid installment amount', 'INVALID_INSTALLMENT_AMOUNT');
  if (!Number.isFinite(expected) || expected <= 0) return 'limited';
  if (!['EGP', 'SAR', 'USD'].includes(normalizedCurrency)) {
    throw financialConflict('Unsupported installment currency', 'INVALID_INSTALLMENT_CURRENCY');
  }

  const [priorRows] = await db.query(
    `SELECT currency,COALESCE(SUM(amount),0) total_paid,
            MIN(course_expected) min_expected,MAX(course_expected) max_expected
       FROM payments
      WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL
        AND status='paid' AND id<>?
        AND course_id <=> ? AND bundle_id <=> ?
      GROUP BY currency`,
    [tenantId, subscriberId, currentPaymentId, courseId, bundleId],
  );
  if (priorRows.some(row => String(row.currency || '').toUpperCase() !== normalizedCurrency)) {
    throw financialConflict('Installment payments cannot mix currencies', 'INSTALLMENT_CURRENCY_MISMATCH');
  }
  const prior = priorRows[0];
  if (prior && (
    (prior.min_expected != null && Math.abs(Number(prior.min_expected) - expected) >= 0.01)
    || (prior.max_expected != null && Math.abs(Number(prior.max_expected) - expected) >= 0.01)
  )) {
    throw financialConflict('Installment expected total changed', 'INSTALLMENT_EXPECTED_MISMATCH');
  }
  const paid = Number(prior?.total_paid || 0) + amount;
  if (paid >= expected) return 'full';
  // How much of the price has been paid, for callers that can turn it into a
  // proportional grant. Bounded below 1 because paid >= expected already
  // returned 'full', and above 0 because a non-positive amount threw earlier.
  return { mode: 'limited', paidRatio: Math.min(0.999, Math.max(0, paid / expected)) };
}

/**
 * The two shapes resolvePaymentAccess answers in, as one.
 *
 * It returns the string 'full' when the course is covered and an object
 * carrying the ratio when it is not — 'full' has no ratio worth reporting, and
 * every existing caller compared against the string. Callers that only care
 * whether access is full keep working; callers that want to size a partial
 * grant read the ratio.
 */
function accessModeOf(result) {
  return typeof result === 'string' ? result : result.mode;
}
function paidRatioOf(result) {
  return typeof result === 'string' ? null : result.paidRatio;
}

function financialConflict(message, code) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

module.exports = { resolvePaymentAccess, accessModeOf, paidRatioOf };
