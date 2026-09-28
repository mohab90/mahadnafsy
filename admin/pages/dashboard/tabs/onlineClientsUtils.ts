import type { Bundle, Course, SubscriberItem } from '../../../types';
import { normBranchId } from '../dashboardShared';
import { cairoDay } from '../../../../shared/cairoDate';

export type SubscriberSavePayload = Partial<SubscriberItem> & Record<string, unknown>;
export type BulkAssignCollectionResult = { ok: boolean; assigned: number; staffCount: number; staff: string[] };

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || '');

import { isCollected, paymentAmountInEGP, toEgp } from '../../../lib/money';
import { clientItems } from '../../../lib/agreedPrice';
import { currencyForBranch } from '../../../lib/branchCurrency';

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

export type ClientMarket = 'local' | 'saudi' | 'intl';
export const MARKET_LABELS: Record<ClientMarket, string> = { local: '🇪🇬 محلي', saudi: '🇸🇦 سعودي', intl: '🌍 دولي' };

/**
 * Which of «محلي / سعودي / دولي» an online client belongs to: where the desk
 * moved them, else what they pay in — جنيه، ريال، دولار — by their latest
 * collected payment, else their branch.
 *
 * «فعلي دولي» used to hold everyone outside Egypt, riyal and dollar together.
 */
export const subscriberMarket = (subscriber: SubscriberItem): ClientMarket => {
  if (subscriber.market === 'local' || subscriber.market === 'saudi' || subscriber.market === 'intl') return subscriber.market;
  const latest = (subscriber.paymentHistory || [])
    .filter(isCollected)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
  if (latest?.currency === 'SAR') return 'saudi';
  if (latest?.currency === 'USD') return 'intl';
  if (latest?.currency === 'EGP') return 'local';
  const branch = normBranchId(subscriber.branch);
  if (branch === 'ONLINE_SAUDI') return 'saudi';
  if (branch === 'ONLINE_ABROAD') return 'intl';
  return 'local';
};

/** The branch a market tab stands for, written when the desk moves a client. */
export const MARKET_BRANCH: Record<ClientMarket, 'ONLINE_EGYPT' | 'ONLINE_SAUDI' | 'ONLINE_ABROAD'> = {
  local: 'ONLINE_EGYPT', saudi: 'ONLINE_SAUDI', intl: 'ONLINE_ABROAD',
};

/** The market tabs are the online desk's; a Dokki or Tagamoa client is not in them. */
export const isOnlineClient = (subscriber: SubscriberItem): boolean =>
  !['DAQQI', 'TAGAMOA'].includes(normBranchId(subscriber.branch) || '');

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

/** The currency a client's prices are read in: their market's, online; their branch's, otherwise. */
export const clientCurrency = (subscriber: SubscriberItem): 'EGP' | 'SAR' | 'USD' => (isOnlineClient(subscriber)
  ? ({ local: 'EGP', saudi: 'SAR', intl: 'USD' } as const)[subscriberMarket(subscriber)]
  : currencyForBranch(normBranchId(subscriber.branch)) as 'EGP' | 'SAR' | 'USD');

/**
 * What the client holds and owes, from the same items, prices and payments the
 * table shows (lib/agreedPrice.ts clientItems) — so a filter and a row cannot
 * disagree. It used to count only courses that had a payment or a saved price,
 * at a catalogue price of nothing: a client enrolled with nothing paid owed
 * nothing, and «مكتمل الدفع» listed them.
 */
export const subscriberBalance = (subscriber: SubscriberItem, courses: Course[], bundles: Bundle[]) => {
  const items = clientItems(subscriber, courses, bundles, clientCurrency(subscriber));
  return {
    items: items.length,
    remainingEgp: items.reduce((sum, item) => sum + toEgp(item.remaining, item.currency), 0),
    paidAnything: items.some(item => item.paid > 0),
  };
};

/** Paid in full: holds something, has paid for it, and owes nothing. */
export const isFullyPaid = (balance: ReturnType<typeof subscriberBalance>) =>
  balance.items > 0 && balance.paidAnything && balance.remainingEgp <= 0;

export const formatCompactNumber = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(Math.round(value));
