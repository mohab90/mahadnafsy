import type { Bundle, ItemBalance } from '../types';

/** «ج.م / ر.س / $» for an amount's own currency. */
export const moneySuffix = (currency?: string) => (currency === 'SAR' ? 'ر.س' : currency === 'USD' ? '$' : 'ج.م');

/** «ادفع قسطا» — which item, how much is left, and in what. */
export type InstallmentModalState = { courseId: string; courseTitle: string; remaining: number; currency: string };

/** A course card's balance: the course's own, or — for a course that came in a track — the track's. */
export type CourseBalance = ItemBalance & { trackTitle?: string };

export function balancesByCourse(balances: ItemBalance[], bundles: Bundle[]): Record<string, CourseBalance> {
  const byCourse: Record<string, CourseBalance> = {};
  balances.forEach(balance => { if (balance.courseId) byCourse[balance.courseId] = balance; });
  // The track he holds names its courses; a part of it (13 Nov 2026) only keeps the money recorded on it and never speaks for a course the whole holds.
  [...balances.filter(balance => balance.bundleId && !balance.partOf), ...balances.filter(balance => balance.bundleId && balance.partOf)].forEach(balance => {
    (bundles.find(bundle => bundle.id === balance.bundleId)?.courses || []).forEach(course => {
      if (!byCourse[course.id]) byCourse[course.id] = { ...balance, trackTitle: balance.title };
    });
  });
  return byCourse;
}
