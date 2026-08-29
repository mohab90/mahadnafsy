import type { PaymentHistoryEntry } from '../../types';

/**
 * How much of one course this client has actually paid.
 *
 * Two clients who had paid in full were set back to limited access within a
 * minute of their payment, from this modal. The screen gave no reason not to:
 * it showed the course, the access badge and the watch progress, and nothing
 * at all about money. Three of its four buttons set limited.
 *
 * This mirrors the rule the server settles on — paid covers expected, so the
 * course is open — using the same fields the payments query uses, so the
 * screen and the database cannot disagree about who has paid.
 */

export type CoursePaymentState = {
  paid: number;
  expected: number;
  /** Expected is known and covered. Undefined expectation is never "settled". */
  settled: boolean;
};

/** Payments carry a course id, a bundle id, or a `bundle:` prefixed course id. */
function appliesTo(entry: PaymentHistoryEntry, courseId: string): boolean {
  if (entry.courseId && entry.courseId === courseId) return true;
  if (!entry.bundleId) return false;
  return entry.bundleId === courseId || `bundle:${entry.bundleId}` === courseId;
}

export function coursePaymentState(
  history: PaymentHistoryEntry[] | undefined,
  courseId: string,
): CoursePaymentState {
  let paid = 0;
  let expected = 0;
  for (const entry of history ?? []) {
    if (!appliesTo(entry, courseId)) continue;
    // A missing status means paid, for rows written before the column existed.
    if (entry.status && entry.status !== 'paid') continue;
    paid += Number(entry.amount) || 0;
    expected = Math.max(expected, Number(entry.courseExpected) || 0);
  }
  // Cent-level tolerance: the same 0.01 the server's price check allows.
  return { paid, expected, settled: expected > 0 && paid >= expected - 0.01 };
}
