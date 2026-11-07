import type { SubscriberItem } from '../../types';
import { courseMoneyFor } from '../../lib/agreedPrice';

/**
 * How much of one course this client has paid, and whether that covers it — read from the server's money lines (api/lib/clientItems.js), which count the price
 * agreed for the client and what they paid before the system. Two clients who had paid in full were set back to limited access within a minute of paying, from
 * the access modal, which showed nothing about money; this is what it shows, and it is the same figure as the client's page and the payment dialog.
 * A course inside a held track is the track's line.
 */
type CoursePaymentState = {
  paid: number;
  expected: number;
  /** Expected is known and covered. Undefined expectation is never "settled". */
  settled: boolean;
};

export function coursePaymentState(subscriber: Pick<SubscriberItem, 'moneyItems'>, courseId: string): CoursePaymentState {
  const line = courseMoneyFor(subscriber, courseId);
  if (!line) return { paid: 0, expected: 0, settled: false };
  // Cent-level tolerance: the same 0.01 the server's price check allows.
  return { paid: line.paid, expected: line.expected, settled: line.expected > 0 && line.remaining <= 0.01 };
}
