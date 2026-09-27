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
