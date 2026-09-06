// Where a payment came from — and specifically, whether anyone actually
// watched the money arrive.
//
// Three things reach the payments table and they are not the same event:
//
//   • the gateway took a card on the website — Paymob has its own record, and
//     the amount is confirmed by someone other than us;
//   • a customer sent a transfer receipt and the accounts desk approved it;
//   • a staff member typed it into the admin, which asserts a payment happened
//     but is not itself evidence that it did.
//
// The third is by far the most common (195 of 308 rows on production) and used
// to be indistinguishable from the first in every screen that listed payments.
// That is how «تم تأكيد الدفع 2800 جنيه» reached a customer for a transfer that
// appeared in no provider report: the row looked exactly like a settled online
// payment because nothing on screen said who had asserted it.

export type PaymentOrigin = 'online' | 'receipt' | 'manual';

type OriginInput = {
  source?: string | null;
  paymentMethod?: string | null;
};

/**
 * Older rows carry no source at all — 105 of them on production, written
 * before the column was populated. They are treated as manual, which is what
 * they almost certainly are: exactly one payment in the whole table came
 * through the gateway. Guessing "online" for an unknown row would restore the
 * confusion this exists to remove, so the unknown case fails toward the label
 * that claims the least.
 */
export function paymentOrigin(payment: OriginInput): PaymentOrigin {
  const source = String(payment.source || '').toLowerCase();
  const method = String(payment.paymentMethod || '').toLowerCase();
  if (source === 'paymob' || source === 'web' || method === 'online_paymob') return 'online';
  if (source === 'manual_transfer') return 'receipt';
  return 'manual';
}

export const PAYMENT_ORIGIN: Record<PaymentOrigin, { label: string; hint: string }> = {
  online: {
    label: 'دفع أونلاين',
    hint: 'دفع العميل بالبطاقة على الموقع — مسجّل عند مزوّد الدفع',
  },
  receipt: {
    label: 'إيصال تحويل',
    hint: 'العميل بعت إيصال التحويل والحسابات اعتمدته',
  },
  manual: {
    label: 'تسجيل من النظام',
    hint: 'موظف سجّل الدفعة يدويًا في لوحة التحكم',
  },
};

/** Tailwind classes for the badge, kept next to the labels so screens agree. */
export const PAYMENT_ORIGIN_CLASS: Record<PaymentOrigin, string> = {
  online: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  receipt: 'bg-sky-50 text-sky-700 border-sky-200',
  manual: 'bg-amber-50 text-amber-800 border-amber-200',
};
