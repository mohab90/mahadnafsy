'use strict';
/**
 * The cash / instalment rates, in one place.
 *
 * They used to live only in client/pages/Enrollment.tsx, which meant the
 * customer was shown a discounted price and the server — the only side that
 * decides what is actually charged — had never heard of either discount. Pick
 * "قسط" on /enroll and checkout billed the full list price.
 *
 * Imported by both sides so a rate change cannot apply to one and not the other.
 */
const CASH_DISCOUNT = 0.15;      // paid in full, immediate full access
const INSTALL_DISCOUNT = 0.07;   // off the base price when paying in instalments
const INSTALL_FIRST_PCT = 0.25;  // the first instalment, as a share of the discounted total


/** The instalment plan's total — the base price after its own discount. */
const installmentTotal = (basePrice) =>
  Math.round(basePrice * (1 - INSTALL_DISCOUNT));

/**
 * What the customer pays right now for this mode.
 *
 * Only an explicit 'installment' bills the instalment share; anything else is
 * treated as paying in full. Testing for 'cash' instead meant an unexpected
 * value quietly selected the *cheaper* of the two, which is the wrong way for
 * a pricing helper to fail.
 */
const amountDueNow = (basePrice, mode) =>
  mode === 'installment'
    ? Math.round(installmentTotal(basePrice) * INSTALL_FIRST_PCT)
    : Math.round(basePrice * (1 - CASH_DISCOUNT));

module.exports = { CASH_DISCOUNT, INSTALL_DISCOUNT, INSTALL_FIRST_PCT, installmentTotal, amountDueNow };
