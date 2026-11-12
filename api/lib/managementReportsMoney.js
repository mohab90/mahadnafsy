'use strict';

// How the management reports (lib/managementReports.js) read a payment.
//
// The owner, 11 Nov 2026: «الدخل الإجمالي بكل شيء، إنما المهم بالنسبالي الحجوزات والشهادات والأقسام، والباقي يبقى أخرى زي كارنيهات وكتب
// واستشارات». Every paid payment falls into exactly ONE of these kinds, so the lines add up to the total with nothing hidden:
//
//   BOOKING      course/track money (salesMoney.js salesPaymentSql) that opened a booking: a payment that is not an instalment-plan
//                payment (is_installment = 0) and is the FIRST paid course/track payment of that client for that course or track
//                (ordered by date, then id) — a full-price payment included.
//   INSTALMENT   the rest of the course/track money: instalment-plan payments (installments.js writes them with is_installment = 1)
//                and any later payment on a course/track the client already has an earlier payment for.
//   CERTIFICATE  payment_type CERTIFICATE — collection, never sales (the owner, 11 Nov 2026).
//   CARNEH / BOOK / CONSULTATION   the other payment types, each by its own name; «أخرى» is their sum.
//
// A payment is paid when its status is 'paid' or, for old rows, NULL; money is amount_egp, or the amount when the payment is in
// pounds. A foreign payment with no stored pound value counts for nothing and is counted apart (weeklySummary.js does the same).

const { salesPaymentSql } = require('./salesMoney');
const { priorPaidTotalSql } = require('./itemMoney');
const { normalizeBranch } = require('./branches');

const MONEY_EGP = "COALESCE(p.amount_egp, CASE WHEN p.currency = 'EGP' THEN p.amount ELSE 0 END)";
const UNCONVERTED_AMOUNT = "CASE WHEN p.amount_egp IS NULL AND p.currency <> 'EGP' THEN p.amount ELSE 0 END";
const PAID_SQL = "p.deleted_at IS NULL AND (p.status IS NULL OR p.status = 'paid')";
const ITEM_KEY = alias => `COALESCE(${alias}.bundle_id, ${alias}.course_id)`;

/** An earlier paid course/track payment of the same client on the same item (a track's own payments are the track's, not its courses'). */
const EARLIER_ON_ITEM_SQL = `EXISTS (
  SELECT 1 FROM payments q
   WHERE q.tenant_id = p.tenant_id AND q.subscriber_id = p.subscriber_id AND q.id <> p.id
     AND q.deleted_at IS NULL AND (q.status IS NULL OR q.status = 'paid') AND ${salesPaymentSql('q')}
     AND ${ITEM_KEY('q')} = ${ITEM_KEY('p')}
     AND (q.date < p.date OR (q.date = p.date AND q.id < p.id)))`;

/** SQL condition, for a payment already known to be course/track money: it opened a booking. */
const BOOKING_SQL = `(p.is_installment = 0 AND (${ITEM_KEY('p')} IS NULL OR NOT ${EARLIER_ON_ITEM_SQL}))`;

const IS_CERTIFICATE_SQL = "UPPER(COALESCE(p.payment_type, '')) = 'CERTIFICATE'";

/** SQL expression: the kind (see above) of the payment `p`. */
const KIND_SQL = `CASE WHEN ${IS_CERTIFICATE_SQL} THEN 'CERTIFICATE'
  WHEN ${salesPaymentSql('p')} THEN (CASE WHEN ${BOOKING_SQL} THEN 'BOOKING' ELSE 'INSTALMENT' END)
  ELSE UPPER(p.payment_type) END`;

/** The client was never a client before `fromParam`: no earlier paid course/track payment and no «مدفوع قبل السيستم» (an old sheet's money). */
const NEW_CLIENT_SQL = `(NOT EXISTS (
  SELECT 1 FROM payments q
   WHERE q.tenant_id = p.tenant_id AND q.subscriber_id = p.subscriber_id
     AND q.deleted_at IS NULL AND (q.status IS NULL OR q.status = 'paid') AND ${salesPaymentSql('q')} AND q.date < ?)
  AND ${priorPaidTotalSql('sub')} = 0)`;

const KIND_LABELS = Object.freeze({
  BOOKING: 'الحجوزات', INSTALMENT: 'الأقساط', CERTIFICATE: 'الشهادات',
  CARNEH: 'كارنيهات', BOOK: 'كتب', CONSULTATION: 'استشارات',
});
const OTHER_KINDS = Object.freeze(['CARNEH', 'BOOK', 'CONSULTATION']);
/** A payment type the enum may grow to hold keeps its own line, named by itself rather than hidden in the sum. */
const kindLabel = kind => KIND_LABELS[kind] || kind;

const BRANCH_GROUPS = Object.freeze({
  ONLINE: 'الأونلاين', DAQQI: 'الدقي', TAGAMOA: 'التجمع', OTHER: 'من غير فرع',
});
const FINE_TO_GROUP = Object.freeze({
  DAQQI: 'DAQQI', TAGAMOA: 'TAGAMOA', ONLINE_EGYPT: 'ONLINE', ONLINE_SAUDI: 'ONLINE', ONLINE_ABROAD: 'ONLINE',
});
/** The report column a branch value (an enum key, a branch id's key or free text) belongs to. */
const groupOfBranch = value => FINE_TO_GROUP[normalizeBranch(value, null)] || 'OTHER';

const num = value => Number(value) || 0;
const round2 = value => Math.round(num(value) * 100) / 100;

module.exports = {
  BOOKING_SQL, BRANCH_GROUPS, KIND_LABELS, KIND_SQL, MONEY_EGP, NEW_CLIENT_SQL, OTHER_KINDS, PAID_SQL, UNCONVERTED_AMOUNT,
  groupOfBranch, kindLabel, num, round2,
};
