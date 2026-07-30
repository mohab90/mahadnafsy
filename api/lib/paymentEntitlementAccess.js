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
  return Number(prior?.total_paid || 0) + amount >= expected ? 'full' : 'limited';
}

function financialConflict(message, code) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

module.exports = { resolvePaymentAccess };
