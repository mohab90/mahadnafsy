'use strict';

// The owner's changes to a month's bonuses (9 Nov 2026, migration 383): what the system worked out (lib/monthlyBonuses.js) stays as it is and each change is kept
// beside it with who made it, when and WHY. The kinds:
//
//   EXCLUDE_BOOKING   a booking leaves a rep's count
//   REASSIGN_BOOKING  a booking counts for another rep
//   WEIGHT_BOOKING    a booking counts as this many bookings
//   TOTAL_OVERRIDE    the employee's month total is this amount (the computed figure is shown beside it)
//   ROUND_OVERRIDE    one round's bonus of a rep is this amount (round 1|2; migration 384) — what the plan worked out is kept beside it
//   COUNT_IN_MONTH    a booking paid in the month after or before counts in THIS month for a rep (migration 384): bookings uploaded late. The payment, its date
//                     and every money record stay as they are — only the month the bonus counts it in moves
//   ROUND_SPLIT       the day the second round starts (2–28; none set: the 16th) — for the whole month (no staff_id: 9 Nov 2026, «الشهر ده الروند التاني بدأ من يوم كذا»),
//                     or, as an exception, for one rep, which overrides the month's
//
// A change is revoked, never deleted; a newer change to the same thing revokes the older. Only the month's bookings can be changed, and only a rep on the
// booking scheme can have one counted for them.

const { uuidv4 } = require('./id');
const { MIN_SPLIT_DAY, MAX_SPLIT_DAY } = require('./bonusPlan');

const KINDS = Object.freeze(['EXCLUDE_BOOKING', 'REASSIGN_BOOKING', 'WEIGHT_BOOKING', 'TOTAL_OVERRIDE', 'ROUND_SPLIT', 'ROUND_OVERRIDE', 'COUNT_IN_MONTH']);
const KIND_LABEL = Object.freeze({
  EXCLUDE_BOOKING: 'استبعاد حجز', REASSIGN_BOOKING: 'نقل حجز لسيلز تاني', WEIGHT_BOOKING: 'تعديل عدد الحجوزات اللي الحجز بيتحسب بيها', TOTAL_OVERRIDE: 'تعديل إجمالي مكافأة الموظف', ROUND_SPLIT: 'يوم بداية الروند التاني',
  ROUND_OVERRIDE: 'تعديل مكافأة روند', COUNT_IN_MONTH: 'حساب حجز في شهر تاني',
});
const MIN_REASON = 3;

const refuse = (message, code = 'BONUS_ADJUSTMENT_INVALID', statusCode = 400) => Object.assign(new Error(message), { statusCode, code });

const shape = row => ({
  id: row.id, year: row.for_year, month: row.for_month, kind: row.kind, kindLabel: KIND_LABEL[row.kind] || row.kind,
  staffId: row.staff_id || null, paymentId: row.payment_id || null, toStaffId: row.to_staff_id || null,
  weight: row.weight == null ? null : Number(row.weight), splitDay: row.split_day == null ? null : Number(row.split_day), round: row.round_no == null ? null : Number(row.round_no), amount: row.amount == null ? null : Number(row.amount),
  reason: row.reason, by: row.created_by_name || null, byId: row.created_by || null, at: row.created_at,
  revokedAt: row.revoked_at || null, revokedBy: row.revoked_by_name || null, revokedReason: row.revoked_reason || null,
});

/** The month's changes still in force (or, with `history`, all of them, the taken-back ones too), oldest first. */
async function listAdjustments(db, { tenantId, year, month, history = false }) {
  try {
    const [rows] = await db.query(
      `SELECT * FROM bonus_adjustments WHERE tenant_id=? AND for_year=? AND for_month=? ${history ? '' : 'AND revoked_at IS NULL'} ORDER BY created_at, id`, [tenantId, year, month]);
    return rows.map(shape);
  } catch (error) {
    // A database that has not had migration 383 yet has no changes to list: the comparison tools run on it before the release.
    if (error && (error.code === 'ER_NO_SUCH_TABLE' || error.errno === 1146)) return [];
    throw error;
  }
}

/** The bookings among these payments that are counted in another month (a COUNT_IN_MONTH still in force), by payment id: a booking counted elsewhere is not counted in its own month. */
async function listCountedElsewhere(db, { tenantId, paymentIds }) {
  if (!paymentIds.length) return new Map();
  try {
    const [rows] = await db.query(
      "SELECT * FROM bonus_adjustments WHERE tenant_id=? AND kind='COUNT_IN_MONTH' AND revoked_at IS NULL AND payment_id IN (?) ORDER BY created_at, id", [tenantId, paymentIds]);
    return new Map(rows.map(row => [row.payment_id, shape(row)]));
  } catch (error) {
    if (error && (error.code === 'ER_NO_SUCH_TABLE' || error.errno === 1146)) return new Map();
    throw error;
  }
}

/**
 * Records one change (inside the caller's transaction), replacing an older one about the same thing.
 * @param input { kind, staffId, paymentId, toStaffId, weight, amount, reason }
 * @param context { bookings: the month's bookings (lib/monthlyBonuses bookingsOf), staff: staff rows with bonus_scheme, ownerOf(booking) }
 */
async function addAdjustment(db, { tenantId, year, month, input, actor, context }) {
  const kind = String(input.kind || '');
  if (!KINDS.includes(kind)) throw refuse('نوع التعديل غير معروف');
  const reason = String(input.reason || '').replace(/\s+/g, ' ').trim();
  if (reason.length < MIN_REASON) throw refuse('لازم تكتب سبب التعديل');
  const staffById = new Map(context.staff.map(member => [member.id, member]));
  const onScheme = (id, scheme = null) => {
    const member = staffById.get(id);
    return Boolean(member && member.bonus_scheme !== 'NONE' && (!scheme || member.bonus_scheme === scheme));
  };
  const record = { kind, staffId: null, paymentId: null, toStaffId: null, weight: null, amount: null, splitDay: null, round: null };

  if (kind === 'ROUND_SPLIT') {
    // No employee: the split of the whole month. An employee: their own exception to it.
    const staffId = String(input.staffId || '');
    if (staffId && !onScheme(staffId, 'SALES_BOOKINGS')) throw refuse('الموظف لازم يكون على نظام «حجوزات (سيلز)»');
    const day = Number(input.splitDay ?? input.day);
    if (!Number.isInteger(day) || day < MIN_SPLIT_DAY || day > MAX_SPLIT_DAY) throw refuse(`يوم بداية الروند التاني لازم يكون رقم من ${MIN_SPLIT_DAY} لـ${MAX_SPLIT_DAY}`);
    record.staffId = staffId || null;
    record.splitDay = day;
  } else if (kind === 'ROUND_OVERRIDE') {
    const staffId = String(input.staffId || '');
    if (!onScheme(staffId, 'SALES_BOOKINGS')) throw refuse('الموظف لازم يكون على نظام «حجوزات (سيلز)»');
    if (context.plan && context.plan.salesPeriod !== 'HALF_MONTH') throw refuse('الروند بيتحسب بس لما نظام السيلز بنص شهر');
    const round = Number(input.round);
    if (round !== 1 && round !== 2) throw refuse('الروند لازم يكون 1 أو 2');
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) throw refuse('المبلغ لازم يكون رقم موجب');
    record.staffId = staffId;
    record.round = round;
    record.amount = Math.round(amount * 100) / 100;
  } else if (kind === 'COUNT_IN_MONTH') {
    // A booking paid in the month before or after is counted in this month for this rep; the payment itself is not touched.
    const staffId = String(input.staffId || '');
    if (!onScheme(staffId, 'SALES_BOOKINGS')) throw refuse('السيلز اللي الحجز هيتحسب له لازم يكون على نظام «حجوزات (سيلز)»');
    const paymentId = String(input.paymentId || '');
    if ((context.bookings || []).some(item => item.paymentId === paymentId)) throw refuse('الحجز ده أصلا من حجوزات الشهر ده');
    const booking = (context.adjacentBookings || []).find(item => item.paymentId === paymentId);
    if (!booking) throw refuse('الحجز لازم يكون أول دفعة له اتدفعت في الشهر اللي قبل الشهر ده أو اللي بعده');
    record.paymentId = booking.paymentId;
    record.staffId = staffId;
  } else if (kind !== 'TOTAL_OVERRIDE') {
    const booking = context.bookings.find(item => item.paymentId === String(input.paymentId || ''));
    if (!booking) throw refuse('الحجز ده مش من حجوزات الشهر ده');
    record.paymentId = booking.paymentId;
    if (kind === 'EXCLUDE_BOOKING') {
      // The rep it leaves: the one asked for, or the one the booking counts for now.
      const from = String(input.staffId || '') || context.countedFor(booking);
      if (!onScheme(from)) throw refuse('الموظف اللي الحجز هيتشال من حسابه مش على نظام المكافآت');
      record.staffId = from;
    } else if (kind === 'REASSIGN_BOOKING') {
      if (!onScheme(String(input.toStaffId || ''), 'SALES_BOOKINGS')) throw refuse('السيلز اللي الحجز هيتنقل له لازم يكون على نظام «حجوزات (سيلز)»');
      record.toStaffId = String(input.toStaffId);
      record.staffId = context.countedFor(booking, { ignoreAdjustments: true });
      if (record.staffId === record.toStaffId) throw refuse('الحجز ده أصلا على السيلز ده');
    } else {
      const weight = Number(input.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 20) throw refuse('عدد الحجوزات لازم يكون رقم من 0 لـ20 (ينفع نص: 1.5)');
      record.weight = Math.round(weight * 100) / 100;
    }
  } else {
    const staffId = String(input.staffId || '');
    if (!onScheme(staffId)) throw refuse('الموظف مش على نظام المكافآت');
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) throw refuse('المبلغ لازم يكون رقم موجب');
    record.staffId = staffId;
    record.amount = Math.round(amount * 100) / 100;
  }

  // One live change per thing: the older one about the same booking (and rep, for an exclusion), the same employee's total or the same employee's round is taken back.
  // A booking counted in another month is one thing across months: moving it again replaces the older move whichever month it was made for.
  const same = kind === 'EXCLUDE_BOOKING' ? ['payment_id', 'staff_id'] : (kind === 'ROUND_OVERRIDE' ? ['staff_id', 'round_no'] : (['TOTAL_OVERRIDE', 'ROUND_SPLIT'].includes(kind) ? ['staff_id'] : ['payment_id']));
  const columnValue = { payment_id: record.paymentId, staff_id: record.staffId, round_no: record.round };
  await db.query(
    `UPDATE bonus_adjustments SET revoked_at=NOW(3), revoked_by=?, revoked_by_name=?, revoked_reason='استُبدل بتعديل أحدث'
      WHERE tenant_id=? ${kind === 'COUNT_IN_MONTH' ? '' : 'AND for_year=? AND for_month=?'} AND kind=? AND revoked_at IS NULL AND ${same.map(column => `${column} <=> ?`).join(' AND ')}`,
    [actor?.id || null, actor?.name || null, tenantId, ...(kind === 'COUNT_IN_MONTH' ? [] : [year, month]), kind, ...same.map(column => columnValue[column])]);
  const id = uuidv4();
  await db.query(
    `INSERT INTO bonus_adjustments (id, tenant_id, for_year, for_month, kind, staff_id, payment_id, to_staff_id, weight, amount, split_day, round_no, reason, created_by, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, tenantId, year, month, kind, record.staffId, record.paymentId, record.toStaffId, record.weight, record.amount, record.splitDay, record.round, reason, actor?.id || null, actor?.name || null]);
  return { id, ...record, reason };
}

/** Takes a change back (it stays in the history). Returns the change, or null when there is no live one by that id. */
async function revokeAdjustment(db, { tenantId, id, actor, reason }) {
  const [[row]] = await db.query('SELECT * FROM bonus_adjustments WHERE id=? AND tenant_id=? AND revoked_at IS NULL FOR UPDATE', [id, tenantId]);
  if (!row) return null;
  await db.query(
    'UPDATE bonus_adjustments SET revoked_at=NOW(3), revoked_by=?, revoked_by_name=?, revoked_reason=? WHERE id=? AND tenant_id=?',
    [actor?.id || null, actor?.name || null, String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 500) || null, id, tenantId]);
  return shape(row);
}

module.exports = { KINDS, KIND_LABEL, listAdjustments, listCountedElsewhere, addAdjustment, revokeAdjustment };
