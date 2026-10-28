// What a client already holds and has paid, as the payment dialog reads it: each course or track with the price agreed
// for it, what has been paid towards it in the dialog's currency, and what is left. Pure — the client, the catalogue
// and the currency in, the rows out — so it is the same wherever the dialog is opened.
import { agreedPriceFor } from '../../lib/agreedPrice';
import { isCollected } from '../../lib/money';
import type { Bundle, Course, PaymentHistoryEntry } from '../../types';
import type { SubjectInfo } from './paymentModalTypes';

export interface HeldOption { cid: string; label: string; px: number; paid: number; remaining: number | null; isBnd: boolean }

export function clientHoldings(subject: SubjectInfo, courses: Course[], bundles: Bundle[], currency: string): {
  payHistory: PaymentHistoryEntry[];
  coursePayMap: Record<string, { paid: number }>;
  enrolledOptions: HeldOption[];
  heldCids: Set<string>;
} {
  // Payment history stats (subscriber only)
  // Refunds stay in this list. lib/refunds.js flips the same payments row to
  // 'refunded' and leaves its positive amount, so every sum below has to say
  // so — otherwise a customer who was refunded reads as having paid it, «مدفوع
  // سابقاً» is too high, «المتبقي» is too low, and the desk under-charges them.
  //
  // Four sums here had no status filter. The Daqqi desk's own copy of this
  // modal did guard its one, so the fault was in every payment taken anywhere
  // else; it surfaced when that copy was folded into this one.
  const payHistory: PaymentHistoryEntry[] = (subject.paymentHistory || []).filter(isCollected);
  const coursePayMap: Record<string, { paid: number }> = {};
  payHistory.forEach(p => {
    // Use 'bundle:ID' as key for bundle payments (where courseId is null but bundleId is set)
    const effId = p.courseId || (p.bundleId ? `bundle:${p.bundleId}` : null);
    if (effId) {
      if (!coursePayMap[effId]) coursePayMap[effId] = { paid: 0 };
      coursePayMap[effId].paid += Number(p.amount);
    }
  });

  // What the client holds. The list was the enrolments alone, and a client who has
  // not been enrolled yet — the Dokki desk's, whose access opens when a payment is
  // approved — held nothing: «قسط» listed no course to pay towards and «تكملة لمسار»
  // never appeared. A course also counts when money has gone against it (collected
  // or waiting), when a price was agreed for it, when «مدفوع قبل السيستم» names it,
  // and when the caller says the client is housed in it.
  const heldByMoney: string[] = [
    ...(subject.paymentHistory || [])
      .filter(p => p.status !== 'failed' && p.status !== 'refunded')
      .map(p => p.courseId || (p.bundleId ? `bundle:${p.bundleId}` : '')),
    ...Object.keys(subject.customPrices || {}).filter(key => !key.startsWith('multi:')),
    ...Object.entries(subject.priorPaid || {}).filter(([, amount]) => Number(amount) > 0).map(([key]) => key),
    ...(subject.heldItemIds || []),
  ].filter(Boolean);
  const enrolledIds: string[] = [...new Set([...(subject.enrolledCourseIds || []), ...heldByMoney])];

  // Auto-detect bundles: if ALL courses of a bundle are in enrolledIds but bundle:ID isn't explicit,
  // treat it as a bundle enrollment and collapse individual courses into one entry.
  const explicitBundleIds = new Set(
    enrolledIds.filter(id => id.startsWith('bundle:')).map(id => id.replace('bundle:', ''))
  );
  type AutoBundle = { bId: string; courseIds: string[] };
  const autoDetectedBundles: AutoBundle[] = [];
  const autoDetectedCourseIds = new Set<string>();
  for (const b of bundles) {
    if (explicitBundleIds.has(b.id)) continue;
    const bCourseIds = (b.courses || []).map(c => c.id);
    if (bCourseIds.length > 1 && bCourseIds.every(cid => enrolledIds.includes(cid))) {
      autoDetectedBundles.push({ bId: b.id, courseIds: bCourseIds });
      bCourseIds.forEach(cid => autoDetectedCourseIds.add(cid));
    }
  }

  const buildPaid = (cid: string, bCourseIds?: string[]) =>
    (Number(subject.priorPaid?.[cid]) || 0) + payHistory.filter(p => {
      if (p.currency !== currency) return false;
      const effId = p.courseId || (p.bundleId ? `bundle:${p.bundleId}` : null);
      if (effId === cid) return true;
      // Also count individual course payments that belong to an auto-detected bundle
      if (bCourseIds && p.courseId && bCourseIds.includes(p.courseId)) return true;
      return false;
    }).reduce((s, p) => s + Number(p.amount), 0);

  const enrolledOptions = [
    // 1. Auto-detected bundles — shown as ONE entry with bundle price
    ...autoDetectedBundles.map(({ bId, courseIds }) => {
      const b = bundles.find(x => x.id === bId)!;
      const bKey = `bundle:${bId}`;
      const px = agreedPriceFor(subject, bKey,
        (b.price as unknown as Record<string, number>)?.[currency] ?? (b.price as unknown as Record<string, number>)?.EGP ?? 0, currency);
      const paid = buildPaid(bKey, courseIds);
      const remaining = px > 0 ? Math.max(0, px - paid) : null;
      return { cid: bKey, label: b.title, px, paid, remaining, isBnd: true };
    }),
    // 2. Individual entries — skip courses already collapsed into an auto-detected bundle
    ...enrolledIds
      .filter(cid => !autoDetectedCourseIds.has(cid))
      .map(cid => {
        const isBnd = cid.startsWith('bundle:');
        const bnd = isBnd ? bundles.find(b => b.id === cid.replace('bundle:', '')) : null;
        const crs = !isBnd ? courses.find(c => c.id === cid) : null;
        const label = bnd?.title || crs?.titleAr || crs?.title || cid;
        // What this client agreed for it, not the catalogue: the instalment
        // list showed list price and «متبقي» against it, whatever was agreed.
        const px = agreedPriceFor(subject, cid, isBnd
          ? ((bnd?.price as unknown as Record<string, number>)?.[currency] ?? (bnd?.price as unknown as Record<string, number>)?.EGP ?? 0)
          : ((crs?.price as unknown as Record<string, number>)?.[currency] ?? (crs?.price as unknown as Record<string, number>)?.EGP ?? 0), currency);
        const paid = buildPaid(cid);
        const remaining = px > 0 ? Math.max(0, px - paid) : null;
        return { cid, label, px, paid, remaining, isBnd };
      }),
  ];

  // Everything the client already holds: an added course outside it is a new booking.
  const heldCids = new Set<string>(enrolledOptions.map(opt => opt.cid));
  autoDetectedCourseIds.forEach(cid => heldCids.add(cid));

  return { payHistory, coursePayMap, enrolledOptions, heldCids };
}
