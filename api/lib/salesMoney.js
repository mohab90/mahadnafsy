'use strict';

// Which payments are SALES money. Certificate money is collection, not sales (the owner, 11 Nov 2026): a rep's revenue, the sales
// performance and breakdown reports, the marketing overview, the goals' actual and «أداء الموظفين» count course and track money only —
// the payments that are the course's (or the bundle's) own, plus old untyped ones. A carnet, a book, a certificate or a consultation
// is collected, and counted by the collection reports (lib/teamReports.js), never as a rep's sale.
//
// The same rule lib/agreedPrice.js ITEM_PAYMENT_SQL and lib/coursePaid.js state for course balances; tests/salesMoney pins that
// the three cannot drift. This is the one place the sales reports take it from.

const SALES_PAYMENT_TYPES = Object.freeze(['COURSE', 'BUNDLE', 'OTHER']);

/** SQL condition: the payments counted as sales, for the payments table under `alias`. Written to be ANDed into a WHERE. */
const salesPaymentSql = (alias = 'p') => `COALESCE(${alias}.payment_type, '') IN ('', ${SALES_PAYMENT_TYPES.map(type => `'${type}'`).join(', ')})`;

module.exports = { SALES_PAYMENT_TYPES, salesPaymentSql };
