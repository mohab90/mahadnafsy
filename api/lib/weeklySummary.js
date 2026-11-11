'use strict';

// The money lines of the Sunday summary email (routes/admin-utils.js): what came in over the last seven days and over the seven before, in pounds.
//
// The email added up payments.amount as it stood — riyals and dollars as if they were pounds — and compared dates as plain strings against a DATETIME column. Here every
// payment counts at its stored pound value (amount_egp); a foreign payment without one counts for nothing and is counted apart, so the email can say the figure is short
// instead of quietly adding 500 riyals as 500 pounds. Certificate money is collection, not sales (the owner, 11 Nov 2026): it is in the total and shown apart.

const { addDaysToDateOnly, cairoDayStartUtc } = require('./dates');

const MONEY_EGP = "COALESCE(p.amount_egp, CASE WHEN p.currency = 'EGP' THEN p.amount ELSE 0 END)";
const IS_CERTIFICATE = "UPPER(COALESCE(p.payment_type, '')) = 'CERTIFICATE'";
const round2 = value => Math.round((Number(value) || 0) * 100) / 100;

/**
 * @param {object} db     a pool or connection
 * @param {{ tenantId: string, today: string }} args   `today` is the Cairo date the email goes out on
 * @returns the week's money: { from, to, totalEgp, courseEgp, certificateEgp, previousTotalEgp, changePct (null when the week before had none), unconverted }
 */
async function weeklyMoney(db, { tenantId, today }) {
  const from = addDaysToDateOnly(today, -7);
  const before = addDaysToDateOnly(today, -14);
  const [[row]] = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN p.date >= ? THEN ${MONEY_EGP} END), 0) AS total,
       COALESCE(SUM(CASE WHEN p.date >= ? AND NOT (${IS_CERTIFICATE}) THEN ${MONEY_EGP} END), 0) AS course,
       COALESCE(SUM(CASE WHEN p.date >= ? AND ${IS_CERTIFICATE} THEN ${MONEY_EGP} END), 0) AS certificates,
       COALESCE(SUM(CASE WHEN p.date >= ? AND p.date < ? THEN ${MONEY_EGP} END), 0) AS previous,
       COALESCE(SUM(p.date >= ? AND p.amount_egp IS NULL AND p.currency <> 'EGP'), 0) AS unconverted
       FROM payments p
      WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND p.date >= ?`,
    [cairoDayStartUtc(from), cairoDayStartUtc(from), cairoDayStartUtc(from), cairoDayStartUtc(before), cairoDayStartUtc(from), cairoDayStartUtc(from), tenantId, cairoDayStartUtc(before)]);
  const previousTotalEgp = round2(row.previous);
  const totalEgp = round2(row.total);
  return {
    from, to: today, totalEgp, courseEgp: round2(row.course), certificateEgp: round2(row.certificates), previousTotalEgp,
    changePct: previousTotalEgp > 0 ? Math.round(((totalEgp - previousTotalEgp) / previousTotalEgp) * 1000) / 10 : null,
    unconverted: Number(row.unconverted) || 0,
  };
}

module.exports = { weeklyMoney };
