import type { Bundle, Course, PaymentHistoryEntry } from '../types';
import type { PaymentDraft } from '../components/PaymentModal';

/**
 * The payments behind a payment dialog's «الإضافات» — each added row, recorded on
 * its own:
 *   · a course the client already holds → an instalment on it;
 *   · a course the client does not hold → a NEW BOOKING, with its price
 *     (the desk's own, a discount on the catalogue, or the catalogue's);
 *   · a certificate, book, carnet, consultation or anything else → its own payment.
 *
 * «لو العميل هيدفع قسط وعاوز اضيف خدمة اخرى واختار ان العميل هيحجز كورس جديد».
 * The client's page recorded the main payment alone and dropped every added row
 * without a word.
 */
export function extraPaymentEntries(
  draft: PaymentDraft,
  deps: {
    courses: Course[];
    bundles: Bundle[];
    staff: { id?: string; name?: string } | null | undefined;
    /** Part of every note: what the desk typed and the transaction number. */
    noteParts: string[];
    now?: number;
  },
): PaymentHistoryEntry[] {
  const { courses, bundles, staff, noteParts, now = Date.now() } = deps;
  const entries: PaymentHistoryEntry[] = [];
  (draft.extraItems || []).forEach((item, index) => {
    const amount = Number(item.amount);
    if (!(amount > 0)) return;
    const base = {
      id: `pay-${now}-xtra-${index}`,
      amount,
      currency: draft.currency,
      paymentMethod: draft.paymentMethod || undefined,
      at: draft.date,
      source: 'staff' as const,
      staffId: staff?.id,
      staffName: staff?.name,
      status: 'paid' as const,
    };
    if (item.type !== 'course') {
      entries.push({
        ...base,
        paymentType: item.type,
        ...(item.type === 'certificate' && item.certType ? { certType: item.certType } : {}),
        isInstallment: false,
        note: [item.label, ...noteParts].filter(Boolean).join(' | ') || undefined,
      });
      return;
    }
    const target = item.courseId || '';
    if (!target) return;
    const isBundle = target.startsWith('bundle:');
    const bundleId = isBundle ? target.slice('bundle:'.length) : undefined;
    const bundle = bundleId ? bundles.find(row => row.id === bundleId) : undefined;
    const course = !isBundle ? courses.find(row => row.id === target) : undefined;
    const title = bundle?.title || course?.titleAr || course?.title || '';
    const custom = Number(item.customExpected) || 0;
    const note = [...noteParts, isBundle && bundle ? `مسار تعليمي: ${bundle.title}` : undefined].filter(Boolean).join(' | ') || undefined;
    if (!item.newBooking) {
      // An instalment: its own price only when the desk changed it, else the one agreed.
      entries.push({
        ...base,
        paymentType: 'course',
        isInstallment: true,
        courseId: isBundle ? undefined : target,
        bundleId,
        courseExpected: custom > 0 ? custom : undefined,
        note,
      });
      return;
    }
    const catalogue = Number((isBundle ? bundle?.price : course?.price)?.[draft.currency]) || 0;
    const discountPct = Number(item.discountPct) || 0;
    const expected = custom > 0 ? custom : (discountPct > 0 && catalogue > 0 ? Math.round(catalogue * (1 - discountPct / 100)) : catalogue);
    if (expected <= 0) {
      throw new Error(`سعر «${title || 'الكورس'}» بالـ${draft.currency} غير مُعرّف — اكتب «السعر المتفق عليه» للكورس الجديد قبل الحفظ.`);
    }
    entries.push({
      ...base,
      paymentType: 'course',
      isInstallment: false,
      courseId: isBundle ? undefined : target,
      bundleId,
      courseExpected: expected,
      note,
    });
  });
  return entries;
}
