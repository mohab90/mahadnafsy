import type { CommunicationRecord, SubscriberItem } from '../../../types';
import { normBranchId } from '../dashboardShared';

export type SubContactDraft = {
  type: CommunicationRecord['type']; date: string;
  notes: string; outcome: string; nextFollowUp: string;
};

export type SubscriberSavePayload = Partial<SubscriberItem> & Record<string, unknown>;
export type BulkAssignCollectionResult = { ok: boolean; assigned: number; staffCount: number; staff: string[] };
export type SubscriberWithCustomPrices = SubscriberItem & { customPrices?: Record<string, number> };

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || '');

export const paymentAmountInEGP = (payment: { amount?: number | string; currency?: string }): number => {
  const amount = Number(payment.amount) || 0;
  if (payment.currency === 'SAR') return amount * 13;
  if (payment.currency === 'USD') return amount * 50;
  return amount;
};

export const isInternationalSubscriber = (subscriber: SubscriberItem): boolean => {
  const branch = normBranchId(subscriber.branch);
  if (branch === 'ONLINE_SAUDI' || branch === 'ONLINE_ABROAD') return true;
  const rawBranch = (subscriber.branch || '').toLowerCase();
  if (rawBranch.includes('saudi') || rawBranch.includes('abroad') || rawBranch.includes('خارج')) return true;
  return (subscriber.paymentHistory || []).some(payment => payment.currency === 'SAR' || payment.currency === 'USD');
};

export const isOnlineSubscriber = (subscriber: SubscriberItem): boolean => {
  const branch = normBranchId(subscriber.branch);
  const rawBranch = (subscriber.branch || '').toLowerCase();
  return branch.startsWith('ONLINE') || rawBranch.includes('online')
    || rawBranch.includes('اونلاين') || rawBranch.includes('اون_لاين') || rawBranch.includes('اون لاين');
};

export const calcSubscribersPaidEGP = (
  subscribers: SubscriberItem[],
  fromDate?: string,
  toDate?: string,
): number => subscribers
  .flatMap(subscriber => subscriber.paymentHistory || [])
  .reduce((sum, payment) => {
    const paymentDate = (payment.at || '').slice(0, 10);
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
  const paid = (subscriber.paymentHistory || []).reduce((sum, payment) => sum + paymentAmountInEGP(payment), 0);
  return expected > 0 ? Math.max(0, expected - paid) : 0;
};

export const formatCompactNumber = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(Math.round(value));
