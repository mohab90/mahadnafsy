// The draft the payment dialog edits, and an empty one. Imported through components/PaymentModal.tsx by the screens
// that open the dialog, which is why it re-exports them.
import { cairoDateOnly } from '../../../shared/cairoDate';
import type { PriceTierKey } from '../../lib/catalogPricing';
import type { PaymentItemType } from '../../types';
import type { SharedPhone } from '../SharedPhonePanel';

// ── Shared draft type ──────────────────────────────────────────────────────
export interface PaymentDraft {
  bookingType: 'new_booking' | 'installment';
  paymentType: PaymentItemType;
  courseId: string;
  customExpected: string;   // override the system price
  discountPct: string;      // % discount
  certType: string;
  certReqId: string;
  amount: string;
  currency: 'EGP' | 'SAR' | 'USD';
  paymentMethod: string;
  transactionId: string;
  fromAccountNumber: string;
  /** Who sent the transfer (payments.sender_name). */
  senderName: string;
  date: string;
  note: string;
  extraItems: ExtraPayItem[];
  // Lead mode, and 'new' mode, which is a lead-shaped customer who does not
  // exist in the system yet.
  branch?: string;
  email?: string;
  nationalId?: string;
  // 'new' mode only: the person is being created by this form.
  name?: string;
  phone?: string;
  /**
   * «تسكين»: the Dokki round this booking seats the client in. Only a Dokki booking
   * carries one; the server seats them when it records the booking.
   */
  daqqiRoundId?: string;
  /**
   * «اختيار السعر الصح بيكون بعد اختيار الكورس والفرع»: the branch tier a new
   * course booking is priced at, and whether the client gets its discount
   * price (lib/catalogPricing.ts). The server charges the catalogue's figure
   * for it, never a typed one.
   */
  priceTier?: PriceTierKey | '';
  useDiscount?: boolean;
  /**
   * «زر الخصم 5 و10 و15 و20 و25 و30 و40 و50%»: a percentage off the chosen
   * branch's list price, for the main course. The server takes only these
   * (DISCOUNT_PERCENTS in api/lib/priceTiers.js); 0 = none.
   */
  tierDiscountPct?: number;
  /** «سعر مختلف»: the client's own price, in customExpected — set_client_price only. */
  customPriceOn?: boolean;
  /** «اسم العميل الحقيقي عربي ثلاثي … بالانجليزي … تاكيد علي رقم التليفون». */
  nameAr?: string;
  nameEn?: string;
  phoneConfirmed?: boolean;
  /** «رقمين لنفس العميل»: the second number of a client made with the booking. */
  phone2?: string;
  /** «حساب مرتبط»: a new person using a number another client holds — who, how related, why. */
  sharedPhone?: SharedPhone | null;
  /** The carnet or book picked from the catalogue (lib/extraItemsCatalog.ts) — the payment's name. */
  itemTitle?: string;
}

export interface ExtraPayItem {
  type: PaymentItemType;
  label: string;
  amount: string;
  courseId?: string;
  certType?: string;
  discountPct?: string;
  customExpected?: string;
  /** A course added to a tier-priced booking takes the same tier; this is its discount choice. */
  useDiscount?: boolean;
  /**
   * A course added to an INSTALMENT that the client does not hold: it is booked
   * (with its price), not paid as an instalment on a course they never booked.
   */
  newBooking?: boolean;
}

export const blankPaymentDraft = (opts?: {
  courseId?: string; branch?: string; currency?: 'EGP' | 'SAR' | 'USD';
  email?: string;
}): PaymentDraft => ({
  bookingType: 'new_booking',
  paymentType: 'course',
  courseId: opts?.courseId || '',
  customExpected: '',
  discountPct: '',
  certType: '',
  certReqId: '',
  amount: '',
  currency: opts?.currency || 'EGP',
  paymentMethod: '',
  transactionId: '',
  fromAccountNumber: '',
  senderName: '',
  date: cairoDateOnly(),
  note: '',
  extraItems: [],
  branch: opts?.branch,
  email: opts?.email,
  nationalId: '',
  name: '',
  phone: '',
  daqqiRoundId: '',
  priceTier: '',
  useDiscount: false,
  tierDiscountPct: 0,
  nameAr: '',
  nameEn: '',
  phoneConfirmed: false,
  itemTitle: '',
});
