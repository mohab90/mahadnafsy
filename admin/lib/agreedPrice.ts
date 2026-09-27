import type { PaymentHistoryEntry, SubscriberItem } from '../types';
import { isCollected } from './money';

/**
 * The price one client agreed for one item — a course id, or 'bundle:<id>'
 * for a track — the same rule as api/lib/agreedPrice.js: their own price,
 * else what their booking recorded (never below what they have paid for it),
 * else the catalogue.
 *
 * Each screen used to answer this its own way — the online table from the
 * client's saved price then the catalogue, the instalment list and «كل
 * المتبقي» from the catalogue alone, the totals bar from the bookings alone —
 * so one client could read three prices on one screen.
 */
export const itemKeyOf = (payment: Pick<PaymentHistoryEntry, 'courseId' | 'bundleId'>): string =>
  payment.bundleId ? `bundle:${payment.bundleId}` : (payment.courseId || '');

const isCoursePayment = (payment: PaymentHistoryEntry) => !payment.paymentType || payment.paymentType === 'course';

/** What has come in for an item, optionally in one currency. */
export function paidFor(subscriber: Pick<SubscriberItem, 'paymentHistory'>, item: string, currency?: string): number {
  return (subscriber.paymentHistory || [])
    .filter(payment => isCollected(payment) && isCoursePayment(payment) && itemKeyOf(payment) === item
      && (!currency || payment.currency === currency))
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
}

type PricedCatalogueItem = { id: string; title: string; price?: unknown; courses?: { id: string }[] };

export type ClientItem = {
  item: string; title: string; isTrack: boolean; currency: string;
  expected: number; paid: number; remaining: number;
};

const catalogueIn = (price: unknown, currency: string): number => {
  const prices = (price || {}) as Record<string, number>;
  return Number(prices[currency]) || Number(prices.EGP) || 0;
};

/**
 * What one client holds — each course or track they bought or were enrolled
 * in, once — with its price agreed, what they paid for it (here and before the
 * system), and what is left. A course that came inside a track is the track's.
 */
export function clientItems(
  subscriber: Pick<SubscriberItem, 'paymentHistory' | 'customPrices' | 'priorPaid' | 'enrolledCourseIds'>,
  courses: PricedCatalogueItem[], bundles: PricedCatalogueItem[], fallbackCurrency = 'EGP',
): ClientItem[] {
  const keys = new Set<string>();
  (subscriber.paymentHistory || []).forEach(payment => {
    const item = itemKeyOf(payment);
    if (item && isCoursePayment(payment)) keys.add(item);
  });
  Object.keys(subscriber.customPrices || {}).forEach(item => { if (!item.startsWith('multi:')) keys.add(item); });
  const inTracks = new Set([...keys].filter(item => item.startsWith('bundle:'))
    .flatMap(item => bundles.find(bundle => `bundle:${bundle.id}` === item)?.courses?.map(course => course.id) || []));
  (subscriber.enrolledCourseIds || []).forEach(id => { if (id && !inTracks.has(id)) keys.add(id); });

  return [...keys].map(item => {
    const isTrack = item.startsWith('bundle:');
    const entry = isTrack ? bundles.find(bundle => `bundle:${bundle.id}` === item) : courses.find(course => course.id === item);
    const currency = (subscriber.paymentHistory || []).find(payment => itemKeyOf(payment) === item)?.currency || fallbackCurrency;
    const expected = agreedPriceFor(subscriber, item, catalogueIn(entry?.price, currency), currency);
    const paid = paidFor(subscriber, item, currency) + (Number(subscriber.priorPaid?.[item]) || 0);
    return { item, title: entry?.title || item, isTrack, currency, expected, paid, remaining: Math.max(0, expected - paid) };
  });
}

export function agreedPriceFor(
  subscriber: Pick<SubscriberItem, 'paymentHistory' | 'customPrices'>, item: string, catalogue = 0, currency?: string,
): number {
  const custom = Number(subscriber.customPrices?.[item]) || 0;
  if (custom > 0) return custom;
  const booked = (subscriber.paymentHistory || [])
    .filter(payment => (isCollected(payment) || payment.status === 'pending') && itemKeyOf(payment) === item
      && (!currency || payment.currency === currency))
    .reduce((max, payment) => Math.max(max, Number(payment.courseExpected) || 0), 0);
  if (booked > 0) return Math.max(booked, paidFor(subscriber, item, currency));
  return catalogue;
}
