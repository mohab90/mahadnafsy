// What a client already holds and has paid, as the payment dialog reads it: each course or track with the price agreed
// for it, what has been paid towards it, and what is left. Pure — the client, the catalogue and the currency in, the rows
// out — so it is the same wherever the dialog is opened.
//
// It is built on lib/agreedPrice.ts clientItems — the function the clients table reads — so the dialog and the table
// cannot say two different things about one client (2 Nov 2026: «من برة متبقي رقم ومن عند زر حجز ودفع متبقي رقم تاني»).
// Two rules the owner made fundamental («دا محتاج يبقى كونسبت أساسي في السيستم»):
//  - a track is paid ONCE: the courses inside it are access, not a debt, and money recorded against one of them counts toward
//    the track. They were listed beside the track, each with its own price and remaining, whenever the track was named by a payment;
//  - a certificate, a carnet, a book, a consultation is its own service. It names the client's course («الكورس المرتبط») without
//    paying for it: its money is never the course's.
import { agreedPriceFor, clientItems, isCoursePayment, paidFor } from '../../lib/agreedPrice';
import { isCollected } from '../../lib/money';
import type { Bundle, Course, PaymentHistoryEntry } from '../../types';
import type { SubjectInfo } from './paymentModalTypes';

interface HeldOption { cid: string; label: string; px: number; paid: number; remaining: number | null; isBnd: boolean }

type Priced = Record<string, number> | undefined;
const priceIn = (price: unknown, currency: string): number => {
  const prices = price as Priced;
  return Number(prices?.[currency]) || Number(prices?.EGP) || 0;
};

export function clientHoldings(subject: SubjectInfo, courses: Course[], bundles: Bundle[], currency: string): {
  payHistory: PaymentHistoryEntry[];
  coursePayMap: Record<string, { paid: number }>;
  enrolledOptions: HeldOption[];
  heldCids: Set<string>;
  /** What the client paid towards this course and what it costs: its own line, or the line of the track that holds it. */
  moneyFor: (courseId: string) => HeldOption | null;
} {
  // Refunds stay in this list. lib/refunds.js flips the same payments row to 'refunded' and leaves its positive amount, so
  // every sum has to say so — otherwise a refunded customer reads as having paid it and the desk under-charges them.
  const payHistory: PaymentHistoryEntry[] = (subject.paymentHistory || []).filter(isCollected);
  const coursePayMap: Record<string, { paid: number }> = {};
  payHistory.filter(isCoursePayment).forEach(p => {
    // 'bundle:ID' for a payment that names a track.
    const effId = p.courseId || (p.bundleId ? `bundle:${p.bundleId}` : null);
    if (effId) {
      if (!coursePayMap[effId]) coursePayMap[effId] = { paid: 0 };
      coursePayMap[effId].paid += Number(p.amount);
    }
  });

  // What the client holds: the enrolments, a track they are enrolled in, every course of a track (one track), and any item that has
  // money, an agreed price or «مدفوع قبل السيستم» against it.
  const items = clientItems({
    paymentHistory: subject.paymentHistory || [],
    customPrices: subject.customPrices,
    priorPaid: subject.priorPaid,
    enrolledCourseIds: subject.enrolledCourseIds || [],
    enrolledBundleIds: subject.enrolledBundleIds,
  }, courses, bundles, currency);

  const labelOf = (item: string): string => {
    if (item.startsWith('bundle:')) return bundles.find(b => b.id === item.slice(7))?.title || item;
    const course = courses.find(c => c.id === item);
    return course?.titleAr || course?.title || item;
  };
  const enrolledOptions: HeldOption[] = items.map(row => ({
    cid: row.item, label: labelOf(row.item), px: row.expected, paid: row.paid,
    remaining: row.expected > 0 ? Math.max(0, row.expected - row.paid) : null, isBnd: row.isTrack,
  }));

  const tracksHeld = enrolledOptions.filter(option => option.isBnd).map(option => bundles.find(b => `bundle:${b.id}` === option.cid));
  const insideTracks = new Set(tracksHeld.flatMap(bundle => (bundle?.courses || []).map(course => course.id)));

  // A course the caller knows the client holds though nothing else says so — the Dokki desk passes the course of the round the payment
  // is opened from — and that no track they hold contains.
  for (const id of subject.heldItemIds || []) {
    if (!id || id.startsWith('multi:') || enrolledOptions.some(option => option.cid === id) || insideTracks.has(id)) continue;
    const isTrack = id.startsWith('bundle:');
    const entry = isTrack ? bundles.find(b => `bundle:${b.id}` === id) : courses.find(c => c.id === id);
    const px = agreedPriceFor(subject, id, priceIn(entry?.price, currency), currency);
    const paid = paidFor(subject, id, currency) + (Number(subject.priorPaid?.[id]) || 0);
    enrolledOptions.push({ cid: id, label: labelOf(id), px, paid, remaining: px > 0 ? Math.max(0, px - paid) : null, isBnd: isTrack });
  }

  // Everything the client already holds: an added course outside it is a new booking.
  const heldCids = new Set<string>(enrolledOptions.map(option => option.cid));
  insideTracks.forEach(id => heldCids.add(id));

  const moneyFor = (courseId: string): HeldOption | null => {
    if (!courseId) return null;
    const own = enrolledOptions.find(option => option.cid === courseId);
    if (own) return own;
    return enrolledOptions.find(option => option.isBnd
      && (bundles.find(b => `bundle:${b.id}` === option.cid)?.courses || []).some(course => course.id === courseId)) || null;
  };

  return { payHistory, coursePayMap, enrolledOptions, heldCids, moneyFor };
}
