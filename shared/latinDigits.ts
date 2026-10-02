/**
 * ٠١٢٣٤٥٦٧٨٩ / ۰۱۲۳۴۵۶۷۸۹ → 0123456789.
 *
 * A phone typed or pasted on an Arabic keyboard arrives in Arabic-Indic digits,
 * which `\D`, `parseFloat` and the API's phone rules all read as "not a digit":
 * the lead was saved with no number and the payment refused it. Applied where a
 * number is typed, so what is stored and what is shown are the same digits.
 */
export const latinDigits = (value: string): string => String(value ?? '')
  .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
