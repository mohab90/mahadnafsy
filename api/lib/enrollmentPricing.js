'use strict';
/**
 * The cash / instalment rates, in one place.
 *
 * They used to live only in client/pages/Enrollment.tsx, which meant the
 * customer was shown a discounted price and the server — the only side that
 * decides what is actually charged — had never heard of either discount. Pick
 * "قسط" on /enroll and checkout billed the full list price.
 *
 * Imported by both sides so a rate change cannot apply to one and not the other
 * (shared/enrollmentPricing.ts is the same module for the browsers).
 *
 * «محتاجين اقدر اعدل الخصم الكاش وخصم القسط من قسم التسويق» (16 Oct 2026): the two discounts are
 * settings — `enroll.cashDiscountPercent` and `enroll.installDiscountPercent` in the site content,
 * edited in التسويق ← الخصومات. These constants are what applies until somebody sets them.
 */
const CASH_DISCOUNT = 0.15;      // paid in full, immediate full access
const INSTALL_DISCOUNT = 0.07;   // off the base price when paying in instalments
const INSTALL_FIRST_PCT = 0.25;  // the first instalment, as a share of the discounted total

const DEFAULT_RATES = Object.freeze({ cash: CASH_DISCOUNT, install: INSTALL_DISCOUNT, first: INSTALL_FIRST_PCT });
// The most a discount can be set to — a typo of «150» must not give a course away.
const MAX_DISCOUNT_PERCENT = 60;

const percentOf = (value, fallback) => {
  const text = String(value ?? '').trim();
  if (text === '') return fallback;
  const n = Number(text.replace('%', ''));
  return Number.isFinite(n) && n >= 0 && n <= MAX_DISCOUNT_PERCENT ? n / 100 : fallback;
};

/** The rates the site content sets; a blank or out-of-range value keeps the default. */
const enrollmentRates = content => ({
  cash: percentOf(content?.['enroll.cashDiscountPercent'], CASH_DISCOUNT),
  install: percentOf(content?.['enroll.installDiscountPercent'], INSTALL_DISCOUNT),
  first: INSTALL_FIRST_PCT,
});

/** The instalment plan's total — the base price after its own discount. */
const installmentTotal = (basePrice, rates = DEFAULT_RATES) =>
  Math.round(basePrice * (1 - rates.install));

/**
 * What the customer pays right now for this mode.
 *
 * Only an explicit 'installment' bills the instalment share; anything else is
 * treated as paying in full. Testing for 'cash' instead meant an unexpected
 * value quietly selected the *cheaper* of the two, which is the wrong way for
 * a pricing helper to fail.
 */
const amountDueNow = (basePrice, mode, rates = DEFAULT_RATES) =>
  mode === 'installment'
    ? Math.round(installmentTotal(basePrice, rates) * rates.first)
    : Math.round(basePrice * (1 - rates.cash));

module.exports = {
  CASH_DISCOUNT, INSTALL_DISCOUNT, INSTALL_FIRST_PCT, DEFAULT_RATES, MAX_DISCOUNT_PERCENT,
  enrollmentRates, installmentTotal, amountDueNow,
};
