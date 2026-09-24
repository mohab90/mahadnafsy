import type { CommunicationRecord, SubscriberItem } from '../../../types';
import { normBranchId } from '../dashboardShared';
import { cairoDay } from '../../../../shared/cairoDate';

export type SubContactDraft = {
  type: CommunicationRecord['type']; date: string;
  notes: string; outcome: string; nextFollowUp: string;
};

export type SubscriberSavePayload = Partial<SubscriberItem> & Record<string, unknown>;
export type BulkAssignCollectionResult = { ok: boolean; assigned: number; staffCount: number; staff: string[] };
export type SubscriberWithCustomPrices = SubscriberItem & { customPrices?: Record<string, number> };

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || '');

import { isCollected, paymentAmountInEGP } from '../../../lib/money';

// Re-exported: seven modules import it from here, and the conversion itself
// now lives in one place instead of three.
export { paymentAmountInEGP };

export const isInternationalSubscriber = (subscriber: SubscriberItem): boolean => {
  const branch = normBranchId(subscriber.branch);
  if (branch === 'ONLINE_SAUDI' || branch === 'ONLINE_ABROAD') return true;
  const rawBranch = (subscriber.branch || '').toLowerCase();
  if (rawBranch.includes('saudi') || rawBranch.includes('abroad') || rawBranch.includes('خارج')) return true;
  return (subscriber.paymentHistory || []).some(payment => payment.currency === 'SAR' || payment.currency === 'USD');
};

export const calcSubscribersPaidEGP = (
  subscribers: SubscriberItem[],
  fromDate?: string,
  toDate?: string,
): number => subscribers
  .flatMap(subscriber => subscriber.paymentHistory || [])
  .reduce((sum, payment) => {
    // «تحصيل اليوم / الأسبوع / الشهر» counted refunded money as collected: a
    // refund flips the same row to 'refunded' and keeps its amount.
    if (!isCollected(payment)) return sum;
    const paymentDate = cairoDay(payment.at);
    if (fromDate && paymentDate < fromDate) return sum;
    if (toDate && paymentDate > toDate) return sum;
    return sum + paymentAmountInEGP(payment);
  }, 0);

export const subscriberRemainingEGP = (subscriber: SubscriberItem): number => {
  const coursePrices: Record<string, number> = {};
  (subscriber.paymentHistory || []).forEach(payment => {
    if (payment.courseId && payment.courseExpected && !coursePrices[payment.courseId]) {
      coursePrices[payment.courseId] = Number(payment.courseExpected) || 0;
    }
  });
  const expected = Object.values(coursePrices).reduce((sum, value) => sum + value, 0);
  // A refunded payment must not reduce what the client still owes.
  const paid = (subscriber.paymentHistory || [])
    .reduce((sum, payment) => (isCollected(payment) ? sum + paymentAmountInEGP(payment) : sum), 0);
  return expected > 0 ? Math.max(0, expected - paid) : 0;
};

export const formatCompactNumber = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(Math.round(value));
