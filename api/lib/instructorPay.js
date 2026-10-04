'use strict';

/**
 * What an instructor earns, and when it is recorded.
 *
 * One rate per instructor (instructor_rates, migration 234):
 *   per_lecture    lecture_rate for each lecture delivered
 *   per_hour       lecture_rate_per_hour × the lecture's hours
 *   revenue_share  revenue_share_pct of each payment for their course
 *                  (lib/paymentCompensation.js) — the default, what ran before
 * plus a retention bonus, on any basis, when a client who studied with them
 * pays for another of their courses.
 *
 * A delivered lecture is recorded where the system already knows it happened:
 * a Dokki round's week marked held (routes/daqqi-rounds.js) and an online live
 * session that ended (routes/lms.js). Each is an instructor_fees row keyed by
 * source_key, so the same lecture is recorded once however often the screen
 * saves, and it lands 'pending' for the accounts team to approve or correct —
 * payroll pays approved fees only. Unmarking a week takes back a fee nobody has
 * approved yet; one that has been approved stays and is the accounts team's to
 * reverse.
 */

const { uuidv4 } = require('./id');

const DEFAULT_LECTURE_HOURS = 2;

/** The staff account behind an instructor id that may be a staff id or a therapist id. */
async function instructorStaffId(db, { tenantId, instructorId }) {
  if (!instructorId) return null;
  const [[staff]] = await db.query(
    'SELECT id FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [instructorId, tenantId]);
  if (staff) return staff.id;
  const [[therapist]] = await db.query(
    'SELECT staff_id FROM therapists WHERE id=? AND tenant_id=? LIMIT 1', [instructorId, tenantId]);
  return therapist?.staff_id || null;
}

async function instructorRate(db, { tenantId, staffId }) {
  if (!staffId) return null;
  const [[rate]] = await db.query(
    `SELECT staff_id, pay_basis, lecture_rate, lecture_rate_per_hour, lecture_hours, revenue_share_pct,
            retention_bonus_type, retention_bonus_value, currency
       FROM instructor_rates WHERE tenant_id=? AND staff_id=? LIMIT 1`,
    [tenantId, staffId]);
  return rate || null;
}

/**
 * The fee one delivered lecture earns, or null when the instructor is not paid
 * by the lecture (revenue share, or no rate set).
 * `hours` is the session's own length when it has one.
 */
function lectureFee(rate, hours = null) {
  if (!rate) return null;
  if (rate.pay_basis === 'per_lecture') {
    const amount = Number(rate.lecture_rate);
    return amount > 0 ? { total: round2(amount), fixed: round2(amount), hours: null, ratePerHour: null } : null;
  }
  if (rate.pay_basis === 'per_hour') {
    const perHour = Number(rate.lecture_rate_per_hour);
    const lectureHours = Number(hours) > 0 ? Number(hours)
      : Number(rate.lecture_hours) > 0 ? Number(rate.lecture_hours) : DEFAULT_LECTURE_HOURS;
    return perHour > 0
      ? { total: round2(perHour * lectureHours), fixed: null, hours: round2(lectureHours), ratePerHour: round2(perHour) }
      : null;
  }
  return null;
}

/**
 * Record one delivered lecture. Idempotent on sourceKey.
 * @returns {Promise<{recorded: boolean, reason?: string}>}
 */
async function recordDeliveredLecture(db, {
  tenantId, instructorId, courseId = null, roundId = null, sourceKey, date, hours = null, note = null, actor = null,
}) {
  const staffId = await instructorStaffId(db, { tenantId, instructorId });
  if (!staffId) return { recorded: false, reason: 'no_staff_account' };
  const rate = await instructorRate(db, { tenantId, staffId });
  const fee = lectureFee(rate, hours);
  if (!fee) return { recorded: false, reason: 'not_paid_by_lecture' };
  const day = String(date || '').slice(0, 10);
  const [result] = await db.query(
    `INSERT IGNORE INTO instructor_fees
       (id, tenant_id, staff_id, course_id, daqqi_round_id, fee_type, hours, rate_per_hour, fixed_amount,
        total_amount, currency, period_month, period_year, status, note, created_by, source_key, lecture_date)
     VALUES (?,?,?,?,?,'lecture',?,?,?,?,?,?,?,'pending',?,?,?,?)`,
    [uuidv4(), tenantId, staffId, courseId, roundId, fee.hours, fee.ratePerHour, fee.fixed, fee.total,
      rate.currency || 'EGP', Number(day.slice(5, 7)), Number(day.slice(0, 4)), note, actor, sourceKey, day]);
  return { recorded: result.affectedRows > 0, reason: result.affectedRows ? undefined : 'already_recorded' };
}

/** Take back a lecture recorded in error, while nobody has approved it. */
async function withdrawDeliveredLecture(db, { tenantId, sourceKey }) {
  const [result] = await db.query(
    "DELETE FROM instructor_fees WHERE tenant_id=? AND source_key=? AND status='pending'", [tenantId, sourceKey]);
  return result.affectedRows > 0;
}

const parseWeeks = value => {
  if (Array.isArray(value)) return value.map(String);
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
};

/**
 * A Dokki round's held weeks changed: a fee for each week newly held, and the
 * pending fee taken back for each week no longer held. Week keys are the
 * week's Saturday («YYYY-MM-DD», admin daqqiScheduleUtils getCurrentWeekKey).
 */
async function syncRoundLectures(db, { tenantId, round, previousHeld, actor = null }) {
  const before = new Set(parseWeeks(previousHeld));
  const after = new Set(parseWeeks(round.held_weeks_json ?? round.heldWeeks));
  const out = { recorded: 0, withdrawn: 0 };
  for (const week of after) {
    if (before.has(week)) continue;
    const result = await recordDeliveredLecture(db, {
      tenantId, instructorId: round.instructor_id, courseId: round.course_id || null, roundId: round.id,
      sourceKey: `daqqi:${round.id}:${week}`, date: week, actor,
      note: `محاضرة روند ${round.code || ''} — أسبوع ${week}`.trim(),
    });
    if (result.recorded) out.recorded += 1;
  }
  for (const week of before) {
    if (after.has(week)) continue;
    if (await withdrawDeliveredLecture(db, { tenantId, sourceKey: `daqqi:${round.id}:${week}` })) out.withdrawn += 1;
  }
  return out;
}

/**
 * A client who studied with an instructor pays for another of their courses:
 * the instructor's retention bonus, once per client and course. Runs inside
 * the payment's transaction (lib/paymentCompensation.js).
 */
async function recordRetentionBonus(db, { tenantId, payment, amountEgp, actor = null }) {
  if (!payment?.course_id || !payment.subscriber_id) return { recorded: false, reason: 'no_course' };
  const [[course]] = await db.query(
    'SELECT instructor_id FROM courses WHERE id=? AND tenant_id=? LIMIT 1', [payment.course_id, tenantId]);
  const staffId = course?.instructor_id || null;
  if (!staffId) return { recorded: false, reason: 'no_instructor' };
  const rate = await instructorRate(db, { tenantId, staffId });
  const value = Number(rate?.retention_bonus_value);
  if (!rate?.retention_bonus_type || !(value > 0)) return { recorded: false, reason: 'no_retention_bonus' };
  // Studied with them before: another of this instructor's courses, paid for
  // (a positive payment) or enrolled in, before this payment.
  const [[before]] = await db.query(
    `SELECT 1 AS ok FROM courses c
      WHERE c.tenant_id=? AND c.instructor_id=? AND c.id<>?
        AND (EXISTS (SELECT 1 FROM payments p WHERE p.tenant_id=c.tenant_id AND p.subscriber_id=? AND p.course_id=c.id
                       AND p.status='paid' AND p.deleted_at IS NULL AND p.amount > 0 AND p.id<>?)
          OR EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=c.tenant_id AND e.subscriber_id=? AND e.course_id=c.id))
      LIMIT 1`,
    [tenantId, staffId, payment.course_id, payment.subscriber_id, payment.id, payment.subscriber_id]);
  if (!before) return { recorded: false, reason: 'first_course_with_instructor' };
  const total = rate.retention_bonus_type === 'percentage'
    ? round2(Number(amountEgp) * Math.min(100, value) / 100)
    : round2(value);
  if (!(total > 0)) return { recorded: false, reason: 'zero' };
  const day = String(payment.date instanceof Date ? payment.date.toISOString() : payment.date || '').slice(0, 10);
  const [result] = await db.query(
    `INSERT IGNORE INTO instructor_fees
       (id, tenant_id, staff_id, course_id, fee_type, fixed_amount, total_amount, currency, period_month, period_year,
        status, note, created_by, source_key, subscriber_id, trigger_payment_id, lecture_date)
     VALUES (?,?,?,?,'retention',?,?,?,?,?,'pending',?,?,?,?,?,?)`,
    [uuidv4(), tenantId, staffId, payment.course_id, total, total,
      rate.retention_bonus_type === 'percentage' ? 'EGP' : (rate.currency || 'EGP'),
      Number(day.slice(5, 7)), Number(day.slice(0, 4)),
      `مكافأة تدوير عميل — ${rate.retention_bonus_type === 'percentage' ? `${value}% من دفعة ${payment.id}` : `مبلغ ثابت`}`,
      actor, `retention:${payment.subscriber_id}:${payment.course_id}`, payment.subscriber_id, payment.id, day || null]);
  return { recorded: result.affectedRows > 0, amount: total };
}

const round2 = n => Math.round(Number(n) * 100) / 100;

module.exports = {
  DEFAULT_LECTURE_HOURS,
  instructorStaffId,
  instructorRate,
  lectureFee,
  recordDeliveredLecture,
  withdrawDeliveredLecture,
  syncRoundLectures,
  recordRetentionBonus,
};
