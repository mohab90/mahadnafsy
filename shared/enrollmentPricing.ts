/**
 * The cash / instalment rates, in one place.
 *
 * They used to live only in client/pages/Enrollment.tsx, which meant the
 * customer was shown a discounted price and the server — the only side that
 * decides what is actually charged — had never heard of either discount. Pick
 * "قسط" on /enroll and checkout billed the full list price.
 *
 * Imported by both sides so a rate change cannot apply to one and not the other.
 * api/lib/enrollmentPricing.js is the same module for the server.
 *
 * «محتاجين اقدر اعدل الخصم الكاش وخصم القسط من قسم التسويق» (16 Oct 2026): the two discounts are
 * settings now — `enroll.cashDiscountPercent` and `enroll.installDiscountPercent` in the site
 * content, edited in التسويق ← الخصومات. These constants are what applies until somebody sets them.
 */
export const CASH_DISCOUNT = 0.15;      // paid in full, immediate full access
export const INSTALL_DISCOUNT = 0.07;   // off the base price when paying in instalments
export const INSTALL_FIRST_PCT = 0.25;  // the first instalment, as a share of the discounted total

export type PayMode = 'cash' | 'installment';
export type EnrollmentRates = { cash: number; install: number; first: number };

export const DEFAULT_RATES: EnrollmentRates = { cash: CASH_DISCOUNT, install: INSTALL_DISCOUNT, first: INSTALL_FIRST_PCT };
/** The most a discount can be set to — a typo of «150» must not give a course away. */
export const MAX_DISCOUNT_PERCENT = 60;

const percentOf = (value: unknown, fallback: number): number => {
  const text = String(value ?? '').trim();
  if (text === '') return fallback;
  const n = Number(text.replace('%', ''));
  return Number.isFinite(n) && n >= 0 && n <= MAX_DISCOUNT_PERCENT ? n / 100 : fallback;
};

/** The rates the site content sets; a blank or out-of-range value keeps the default. */
export const enrollmentRates = (content?: Record<string, string | undefined> | null): EnrollmentRates => ({
  cash: percentOf(content?.['enroll.cashDiscountPercent'], CASH_DISCOUNT),
  install: percentOf(content?.['enroll.installDiscountPercent'], INSTALL_DISCOUNT),
  first: INSTALL_FIRST_PCT,
});

/** A rate as a whole-number percent for display: 0.15 → 15. */
export const percentLabel = (rate: number): number => Math.round(rate * 1000) / 10;

/** The instalment plan's total — the base price after its own discount. */
export const installmentTotal = (basePrice: number, rates: EnrollmentRates = DEFAULT_RATES): number =>
  Math.round(basePrice * (1 - rates.install));

/**
 * What the customer pays right now for this mode.
 *
 * Only an explicit 'installment' bills the instalment share; anything else is
 * treated as paying in full. Testing for 'cash' instead meant an unexpected
 * value quietly selected the *cheaper* of the two, which is the wrong way for
 * a pricing helper to fail.
 */
export const amountDueNow = (basePrice: number, mode: PayMode, rates: EnrollmentRates = DEFAULT_RATES): number =>
  mode === 'installment'
    ? Math.round(installmentTotal(basePrice, rates) * rates.first)
    : Math.round(basePrice * (1 - rates.cash));
