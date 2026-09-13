/**
 * How a customer says which way they paid — one vocabulary, one source.
 *
 * There were three, and none of them was the setting an admin actually edits:
 *
 *   • /checkout wrote free Arabic text — 'انستا باي', 'فودافون كاش', 'تحويل بنكي'
 *   • /my-account wrote codes — 'instapay', 'bank_transfer', 'vodafone_cash'
 *   • the admin's «طرق الدفع اليدوي المتاحة للعميل» wrote codes into
 *     payment_gateway.manual.supported_methods, which no customer screen read
 *
 * So both lists were hardcoded, ticking a channel off in the settings changed
 * nothing a customer saw, and the same channel reached payment_proofs under two
 * different spellings. The customer's own «حسب الوسيلة» summary then grouped on
 * the raw value and showed the bare token `instapay` next to «انستا باي» as if
 * they were two different things.
 *
 * The wire value is now always the code. Arabic is a label, applied at render.
 */

/** The codes the manual-payment integration understands. */
export const PAYMENT_METHOD_CODES = ['cash', 'instapay', 'bank_transfer', 'vodafone_cash'] as const;
export type PaymentMethodCode = typeof PAYMENT_METHOD_CODES[number];

/**
 * Shown when the gateway settings have never been touched. An empty stored list
 * means "nobody has configured this yet", not "this institute refuses
 * transfers" — and transfers are how most of its money arrives, so the empty
 * case must not leave a customer with no way to say how they paid.
 */
export const DEFAULT_PAYMENT_METHODS: PaymentMethodCode[] = ['instapay', 'bank_transfer', 'vodafone_cash'];

const LABELS: Record<string, string> = {
  cash: 'نقدي',
  instapay: 'انستا باي',
  bank_transfer: 'تحويل بنكي',
  vodafone_cash: 'فودافون كاش',
  same_as_payment: 'إرجاع على نفس وسيلة الدفع',
  // Not offered as choices any more, but rows carrying them already exist.
  fawry: 'فوري',
  other: 'أخرى',
  card: 'بطاقة بنكية',
  wallet: 'محفظة إلكترونية',
  online_paymob: 'دفع إلكتروني',
  // Not a rail a customer picks: the desk entered the payment by hand.
  manual: 'يدوي',
};

/**
 * Every spelling either screen has ever written, mapped to its code.
 *
 * Historic rows are not rewritten — a payment record is evidence of what
 * happened and gets read far more often than it gets migrated — so the two old
 * vocabularies have to keep resolving on the way out.
 */
const ALIASES: Record<string, string> = {
  'انستا باي': 'instapay',
  'انستاباي': 'instapay',
  'إنستا باي': 'instapay',
  'إنستاباي': 'instapay',
  'فودافون كاش': 'vodafone_cash',
  'فودافون': 'vodafone_cash',
  'تحويل بنكي': 'bank_transfer',
  'تحويل': 'bank_transfer',
  'حوالة بنكية': 'bank_transfer',
  'نقدي': 'cash',
  'كاش': 'cash',
  'اخرى': 'other',
  'أخرى': 'other',
  'فوري': 'fawry',
  banktransfer: 'bank_transfer',
  'bank-transfer': 'bank_transfer',
  vodafonecash: 'vodafone_cash',
  'vodafone-cash': 'vodafone_cash',
  bank: 'bank_transfer',
  // What most of the orders table holds, in upper case.
  transfer: 'bank_transfer',
  // تحويل عميل أونلاين → استرداد wrote these two, and neither resolved: a
  // refund recorded there read back as the bare token 'vodafone'.
  vodafone: 'vodafone_cash',
  // The gateway names itself in orders.payment_method.
  paymob: 'online_paymob',
  'محفظة إلكترونية': 'wallet',
  'محفظة': 'wallet',
};

/**
 * A refund goes back by one of the same rails, or by whichever one it arrived
 * on — which the desk records rather than looks up.
 *
 * Two screens used to offer this and they disagreed: «استرداد» on the online
 * client wrote codes ('bank', 'vodafone'), the financial tab's refund dialog
 * wrote Arabic labels («تحويل بنكي»), and the inbox printed whichever it found
 * raw. The same rail therefore appeared under two names depending on who
 * recorded it.
 */
export const SAME_AS_PAYMENT = 'same_as_payment';
export const REFUND_METHOD_CODES = [...PAYMENT_METHOD_CODES, SAME_AS_PAYMENT] as const;

/**
 * The code for a stored value, or '' when it is something else entirely — the
 * institute's own cash boxes («خزنة الفرع») are free text an admin types, and
 * forcing those into this vocabulary would rename them on screen.
 */
export function normalizePaymentMethod(raw?: string | null): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  const lower = value.toLowerCase().replace(/\s+/g, ' ');
  if ((PAYMENT_METHOD_CODES as readonly string[]).includes(lower)) return lower;
  if (LABELS[lower]) return lower;
  return ALIASES[value] || ALIASES[lower] || '';
}

/** What a human should read. Unrecognised values are shown as they were saved. */
export function paymentMethodLabel(raw?: string | null): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  const code = normalizePaymentMethod(value);
  return (code && LABELS[code]) || LABELS[value.toLowerCase()] || value;
}

/** Keeps only codes this build knows, in the order the settings list them. */
export function sanitizePaymentMethods(list?: unknown): PaymentMethodCode[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: PaymentMethodCode[] = [];
  for (const entry of list) {
    const code = normalizePaymentMethod(String(entry));
    if (!code || seen.has(code)) continue;
    if (!(PAYMENT_METHOD_CODES as readonly string[]).includes(code)) continue;
    seen.add(code);
    out.push(code as PaymentMethodCode);
  }
  return out;
}
