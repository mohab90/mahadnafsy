'use strict';

// What counts as a rep's revenue, bookings and target (11 Nov 2026, the owner: certificate money is COLLECTION, not sales): the course and track money only —
// the project's predicate (lib/coursePaid.js, lib/monthlyBonuses.js) — so a certificate, a book, a carnet or a consultation paid beside a course is never part of a rep's
// sales. The exception is a collector (bonus scheme COLLECTION / COLLECTION_BOOKINGS, or the COLLECTION role): what he collects is collection, certificates included.

const COURSE_MONEY_SQL = "COALESCE(payment_type, '') IN ('', 'COURSE', 'BUNDLE', 'OTHER')";

/**
 * The SQL condition that keeps a payments row in the revenue of the employee on it (`payments.staff_id`).
 * @param {string} alias the payments table's name or alias in the query
 */
function repMoneySql(alias = 'payments') {
  const own = COURSE_MONEY_SQL.replace('payment_type', `${alias}.payment_type`);
  return `(${own} OR EXISTS (SELECT 1 FROM staff collector WHERE collector.id=${alias}.staff_id AND collector.tenant_id=${alias}.tenant_id`
    + ` AND (collector.bonus_scheme IN ('COLLECTION','COLLECTION_BOOKINGS') OR collector.role='COLLECTION')))`;
}

module.exports = { COURSE_MONEY_SQL, repMoneySql };
