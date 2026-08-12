// The institute's payment methods / cash boxes.
//
// One reader for one setting. Five screens each parsed
// content['finance.payment_methods'] themselves and each carried its own
// different fallback list, so before the key was ever saved the booking dialog
// offered one set, the Daqqi dialogs another, the financial tab a third and the
// settings page a fourth — which is what "the right ones from settings do not
// show up" was.
//
// الإعدادات ← وسائل الدفع owns the value; everything else reads it through here.

export const DEFAULT_PAYMENT_METHODS = [
  'خزنة الدقي',
  'خزنة الفرع',
  'فودافون كاش',
  'انستا باي',
  'تحويل بنكي',
  'كاش',
  'أخرى',
];

/** Parse the stored `a||b||c` string, falling back to the shared default list. */
export function parsePaymentMethods(raw: string | undefined | null): string[] {
  const parsed = String(raw || '')
    .split('||')
    .map(s => s.trim())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_PAYMENT_METHODS;
}
