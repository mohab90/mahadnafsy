import type { PaymentHistoryEntry, SubscriberItem } from '../types';

/**
 * What a client holds and owes is worked out ONCE, on the server (api/lib/clientItems.js), and every list row arrives with it as `moneyItems`; the client's page and the
 * payment dialog ask GET /api/admin/clients/:id/money, which is the same function on fresh data (8 Nov 2026: «نتأكد إن كلها متطابقة»). The browser used to carry a third
 * copy of the rule — the client's own price, else what their booking recorded, else the catalogue — and each screen read it from whatever copy of the client it
 * happened to hold. It is gone: this file only names an item and sorts a payment row; a screen that draws a price draws the server's. A test
 * (api/tests/oneMoneySourceBrowser.test.js) fails if a price rule comes back.
 */

/** One course or track a client holds: the price agreed for it, where that came from, what was paid (here and before the system) and what is left. */
export type MoneyLine = {
  item: string; title: string; isTrack: boolean; currency: string;
  /** A track that is a part of a bigger one he holds (13 Nov 2026): kept only because it carries money recorded on it, so no balance moves — the lists name the whole, not the part. */
  partOf?: string | null;
  /** The courses a track holds (empty for a course). */
  courseIds: string[];
  catalogue: number;
  /** The agreed price; 0 when there is none. */
  expected: number;
  source: 'client' | 'booking' | 'catalogue' | 'none';
  /** Recorded here plus «مدفوع قبل السيستم». */
  paid: number; priorPaid: number;
  /** Recorded but not yet approved — not counted in `paid`. */
  pending: number;
  remaining: number;
};

/** The id of what a payment names: a course id, or 'bundle:<id>' for a track. */
export const itemKeyOf = (payment: Pick<PaymentHistoryEntry, 'courseId' | 'bundleId'>): string =>
  payment.bundleId ? `bundle:${payment.bundleId}` : (payment.courseId || '');

// A row that names a course or track and is typed «other» is that course's money (the API says 'other' for a row whose payment_type was never set); one typed
// «bundle» is a track's. A certificate, a carnet, a book is its own service. The API sends 'bundle' although the union does not list it.
export const isCoursePayment = (payment: PaymentHistoryEntry) => !payment.paymentType || payment.paymentType === 'course'
  || (payment.paymentType as string) === 'bundle'
  || (payment.paymentType === 'other' && Boolean(payment.courseId || payment.bundleId));

/** What the server worked out for this client's row; nothing until the row has it. */
export const moneyItemsOf = (subscriber: Pick<SubscriberItem, 'moneyItems'> | null | undefined): MoneyLine[] => subscriber?.moneyItems || [];

/** What a line is called on screen: a part of a bigger track says so, and is never shown as a second track beside its whole. */
export const moneyLineTitle = (line: Pick<MoneyLine, 'title' | 'partOf'>): string => (line.partOf ? `${line.title} (جزء من مسار أكبر)` : line.title);

/** What one client paid for one course and still owes on it: the course's own line, or the line of the track that holds it. */
export function courseMoneyFor(subscriber: Pick<SubscriberItem, 'moneyItems'>, courseId: string): MoneyLine | null {
  const items = moneyItemsOf(subscriber);
  return items.find(item => item.item === courseId) || items.find(item => item.isTrack && item.courseIds.includes(courseId)) || null;
}
