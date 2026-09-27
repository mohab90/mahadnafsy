import type { SubscriberItem } from '../../../types';
import { normBranchId } from '../dashboardShared';
import { cairoDay } from '../../../../shared/cairoDate';

export type SubscriberSavePayload = Partial<SubscriberItem> & Record<string, unknown>;
export type BulkAssignCollectionResult = { ok: boolean; assigned: number; staffCount: number; staff: string[] };

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || '');

import { isCollected, paymentAmountInEGP, toEgp } from '../../../lib/money';
import { agreedPriceFor, itemKeyOf, paidFor } from '../../../lib/agreedPrice';

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

// What the client still owes, in EGP, item by item at the price agreed
// (lib/agreedPrice.ts). It summed bookings that had recorded a price — courses
// only, the first one found — so tracks and saved prices never counted, and it
// took every payment off that total, certificates and books included.
export const subscriberRemainingEGP = (subscriber: SubscriberItem): number => {
  const items = new Map<string, string>();
  (subscriber.paymentHistory || []).forEach(payment => {
    const item = itemKeyOf(payment);
    if (item && (!payment.paymentType || payment.paymentType === 'course') && !items.has(item)) items.set(item, payment.currency || 'EGP');
  });
  Object.keys(subscriber.customPrices || {}).forEach(item => {
    if (!item.startsWith('multi:') && !items.has(item)) items.set(item, 'EGP');
  });
  let remaining = 0;
  items.forEach((currency, item) => {
    const owed = agreedPriceFor(subscriber, item, 0, currency) - paidFor(subscriber, item, currency)
      - (Number(subscriber.priorPaid?.[item]) || 0);
    if (owed > 0) remaining += toEgp(owed, currency);
  });
  return remaining;
};

export const formatCompactNumber = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(Math.round(value));
