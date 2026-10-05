'use strict';

/**
 * «مكافأة حجز الكورس» — what a course or track pays, once per client, to:
 *
 *   sales       the rep the client belongs to (else the rep who recorded it)
 *   service     the desk that served the booking: reception, collection or
 *               customer service — whoever of them recorded it, else the
 *               client's collection officer
 *   instructor  the course's lecturer
 *
 * Each is a fixed amount in EGP or a percentage of the booking's price, set on
 * the course page (courses/bundles.booking_bonuses_json, lib/priceTiers.js).
 * Paid on the booking — the first paid payment for that client and item — and
 * never again for the same pair: the rows are keyed on client and item, so a
 * second instalment, a retry or a replay finds the row already there.
 *
 * Sales and service bonuses are commission rows (crm_commissions), so payroll
 * collects them with the rest of the month's commission; the lecturer's is an
 * instructor fee, so it is approved and paid with their other fees.
 */

const { uuidv4 } = require('./id');
const { normalizeBonuses } = require('./priceTiers');

const SALES_ROLES = new Set(['sales', 'sales_collection_manager']);
const SERVICE_ROLES = new Set(['collection', 'support', 'reception_daqqi', 'reception_tagamoa']);

const round2 = n => Math.round(Number(n) * 100) / 100;

function bonusAmount(bonus, baseEgp) {
  if (!bonus) return 0;
  if (bonus.type === 'percent') return round2(Number(baseEgp) * Math.min(100, bonus.value) / 100);
  return round2(bonus.value);
}

async function staffRole(db, tenantId, staffId) {
  if (!staffId) return null;
  const [[row]] = await db.query(
    'SELECT role FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [staffId, tenantId]);
  return String(row?.role || '').toLowerCase() || null;
}

/**
 * Runs inside the payment's transaction (lib/paymentCompensation.js).
 * @param {object} payment  the paid payment row, with subscriber, item and staff columns
 * @param {number} amountEgp this payment's EGP value
 */
async function recordBookingBonuses(db, { tenantId, payment, amountEgp, actor = null }) {
  const itemType = payment.bundle_id ? 'bundle' : payment.course_id ? 'course' : null;
  const itemId = payment.bundle_id || payment.course_id;
  if (!itemType || !payment.subscriber_id) return { recorded: 0 };
  // A certificate, a book or a fee paid against a course is not its booking.
  if (!['COURSE', 'BUNDLE'].includes(String(payment.payment_type || '').toUpperCase())) return { recorded: 0 };
  const table = itemType === 'bundle' ? 'bundles' : 'courses';
  const [[item]] = await db.query(
    `SELECT booking_bonuses_json${itemType === 'course' ? ', instructor_id' : ''}, title
       FROM \`${table}\` WHERE id=? AND tenant_id=? LIMIT 1`, [itemId, tenantId]);
  const bonuses = normalizeBonuses(item?.booking_bonuses_json);
  if (!Object.keys(bonuses).length) return { recorded: 0 };

  // The booking's price in EGP: the agreed price for the item at this
  // payment's exchange rate, else the payment itself.
  const rate = Number(payment.amount) > 0 ? Number(amountEgp) / Number(payment.amount) : 1;
  const baseEgp = Number(payment.course_expected) > 0 ? round2(Number(payment.course_expected) * rate) : Number(amountEgp);
  const day = String(payment.date instanceof Date ? payment.date.toISOString() : payment.date || '').slice(0, 10);
  const month = Number(day.slice(5, 7)) || new Date().getMonth() + 1;
  const year = Number(day.slice(0, 4)) || new Date().getFullYear();
  const label = item?.title || itemId;
  let recorded = 0;

  const recorderRole = await staffRole(db, tenantId, payment.staff_id);
  const recipients = {
    sales: payment.assigned_sales_id || (SALES_ROLES.has(recorderRole) ? payment.staff_id : null),
    service: SERVICE_ROLES.has(recorderRole) ? payment.staff_id : (payment.assigned_cs_id || null),
  };

  for (const role of ['sales', 'service']) {
    const staffId = recipients[role];
    const amount = bonusAmount(bonuses[role], baseEgp);
    if (!staffId || !(amount > 0)) continue;
    // payment_id carries the client and item, not the payment: it is what makes
    // the bonus once per booking rather than once per instalment.
    const [result] = await db.query(
      `INSERT IGNORE INTO crm_commissions
         (id,tenant_id,branch_id,staff_id,payment_id,client_id,client_type,
          payment_amount,commission_amount,calc_details,month,year,status,note,created_at)
       VALUES (?,?,?,?,?,?,'subscriber',?,?,?,?,?,'PENDING',?,NOW())`,
      [uuidv4(), tenantId, payment.branch_id || 'branch-other', staffId,
        `booking:${role}:${payment.subscriber_id}:${itemId}`.slice(0, 100),
        payment.subscriber_id, baseEgp, amount,
        JSON.stringify({ kind: 'booking_bonus', role, bonus: bonuses[role], baseEgp, paymentId: payment.id, itemType, itemId }),
        month, year,
        `مكافأة حجز ${label} — ${role === 'sales' ? 'سيلز' : 'خدمة عملاء/تحصيل/رسيبشن'}`]);
    recorded += result.affectedRows > 0 ? 1 : 0;
  }

  const instructorId = item?.instructor_id || null;
  const instructorAmount = bonusAmount(bonuses.instructor, baseEgp);
  if (instructorId && instructorAmount > 0) {
    const [result] = await db.query(
      `INSERT IGNORE INTO instructor_fees
         (id, tenant_id, staff_id, course_id, fee_type, fixed_amount, total_amount, currency, period_month, period_year,
          status, note, created_by, source_key, subscriber_id, trigger_payment_id, lecture_date)
       VALUES (?,?,?,?,'fixed',?,?,'EGP',?,?,'pending',?,?,?,?,?,?)`,
      [uuidv4(), tenantId, instructorId, payment.course_id || null, instructorAmount, instructorAmount,
        month, year, `مكافأة حجز ${label}`, actor,
        `booking:${payment.subscriber_id}:${itemId}`, payment.subscriber_id, payment.id, day || null]);
    recorded += result.affectedRows > 0 ? 1 : 0;
  }
  return { recorded };
}

module.exports = { recordBookingBonuses, bonusAmount, SERVICE_ROLES };
