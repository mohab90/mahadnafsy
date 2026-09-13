/**
 * How a price is written for a customer.
 *
 * Two things were wrong and they had one cause. `price_egp` is DECIMAL(10,2)
 * and mysql2 returns a DECIMAL as a string, so «7900.00» travelled to the
 * browser as text and was printed exactly as it arrived — no thousands
 * separator, two dead decimals, on every card of every catalogue page. The same
 * string then met `oldPrice > currentPrice`, which compares text: «11500.00» is
 * not greater than «5600.00», so ten of the thirty-one products advertised no
 * discount at all.
 *
 * The API coerces at the boundary now (api/lib/mappers.js). This is the other
 * half: one place that decides how the number reads, and one place that knows
 * the symbols — nine screens each carried their own copy of that ternary.
 *
 * 'ar-EG-u-nu-latn' is the same locale the admin's 380 number renders use:
 * Arabic grouping, Latin digits. The digits matter — a browser set to Arabic
 * renders «١٤٬٨٠٠» from a bare toLocaleString, and prices people copy into a
 * bank transfer should be the ones on their keyboard.
 */

export type PriceCurrency = 'EGP' | 'SAR' | 'USD';

const SYMBOL: Record<string, string> = { EGP: 'ج.م', SAR: 'ر.س', USD: '$' };

/** The symbol for a currency code; unknown codes keep their code. */
export function currencySymbol(currency?: string | null): string {
  const code = String(currency || 'EGP').toUpperCase();
  return SYMBOL[code] || code;
}

/** A price as a number, whatever the API sent. */
export function toAmount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The number alone: «14,800», or «14,800.5» when the piastres are real.
 *
 * Trailing zeros are dropped because every price in this catalogue is a whole
 * pound, and «14800.00» is harder to read than «14,800» for no gain.
 */
export function formatAmount(value: unknown): string {
  const amount = toAmount(value);
  return amount.toLocaleString('ar-EG-u-nu-latn', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** The number and its symbol: «14,800 ج.م». */
export function formatPrice(value: unknown, currency?: string | null): string {
  return `${formatAmount(value)} ${currencySymbol(currency)}`;
}

/**
 * Is this a real discount?
 *
 * Both sides coerced, so it stays an arithmetic question even if a caller is
 * handed a string again by some future endpoint. A price that merely equals the
 * old one is not a discount and must not draw a strikethrough.
 */
export function isDiscounted(originalPrice: unknown, currentPrice: unknown): boolean {
  const was = toAmount(originalPrice);
  const now = toAmount(currentPrice);
  return was > 0 && now > 0 && was > now;
}

/** How much off, as a whole percent. 0 when there is no discount. */
export function discountPercent(originalPrice: unknown, currentPrice: unknown): number {
  if (!isDiscounted(originalPrice, currentPrice)) return 0;
  const was = toAmount(originalPrice);
  const now = toAmount(currentPrice);
  return Math.round(((was - now) / was) * 100);
}
