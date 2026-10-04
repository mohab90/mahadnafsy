'use strict';

const { cairoToday } = require('./dates');

const DEFAULT_POLICY = Object.freeze({
  id: null,
  version: 1,
  annual_leave_days: 21,
  sick_leave_days: 14,
  work_days_per_month: 26,
  workday_minutes: 480,
  grace_minutes: 15,
  overtime_multiplier: 1.5,
  audit_retention_days: 2555,
  // Friday off, 11:00–18:30, a monthly morning permission of 2 h and evening
  // one of 1.5 h, lateness >10 min ¼ day, >30 ½, >2 h a whole day — the
  // institute's own rules (migration 243), used until HR saves a policy.
  weekend_days_json: [5],
  work_start_time: '11:00:00',
  work_end_time: '18:30:00',
  morning_permit_minutes: 120,
  evening_permit_minutes: 90,
  morning_permits_per_month: 1,
  evening_permits_per_month: 1,
  late_tiers_json: [{ over: 10, days: 0.25 }, { over: 30, days: 0.5 }, { over: 120, days: 1 }],
  early_leave_tiered: 1,
});
const ATTENDANCE_POLICY_COLUMNS = `work_start_time,work_end_time,morning_permit_minutes,evening_permit_minutes,
            morning_permits_per_month,evening_permits_per_month,late_tiers_json,early_leave_tiered`;
// LATE_PERMIT / EARLY_LEAVE are إذن تأخير and إذن انصراف مبكر. They ride the
// same request-and-approve flow as leave because that is what they are — a
// request a manager says yes or no to — but they are not days off, which is
// what calculateLeaveDays below has to get right.
const LEAVE_TYPES = new Set([
  'ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'EMERGENCY', 'PERMISSION', 'OTHER',
  'LATE_PERMIT', 'EARLY_LEAVE',
]);

// The two permissions counted in hours: a morning one is arriving late, an
// evening one is leaving early.
const HOUR_PERMITS = new Set(['LATE_PERMIT', 'EARLY_LEAVE']);
// What a request is called in the notices HR and the employee read.
const LEAVE_LABELS_AR = Object.freeze({
  ANNUAL: 'إجازة سنوية', SICK: 'إجازة مرضية', UNPAID: 'إجازة بدون راتب', MATERNITY: 'إجازة أمومة',
  EMERGENCY: 'إجازة طارئة', PERMISSION: 'إذن نصف يوم', OTHER: 'إجازة',
  LATE_PERMIT: 'إذن صباحي (تأخير)', EARLY_LEAVE: 'إذن مسائي (انصراف مبكر)',
});
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The hours an إذن covers — { startTime, endTime } as HH:MM — or nulls for a
 * type counted in days. A permission has to name its window: HR approving
 * «إذن تأخير» without knowing until when is approving an open cheque.
 */
function permitWindow(type, startTime, endTime) {
  if (!HOUR_PERMITS.has(type)) return { startTime: null, endTime: null };
  const start = String(startTime || '').trim();
  const end = String(endTime || '').trim();
  if (!HHMM.test(start) || !HHMM.test(end)) {
    throw Object.assign(new Error('حدد وقت الإذن: من الساعة كام لحد الساعة كام'), { statusCode: 400 });
  }
  if (end <= start) {
    throw Object.assign(new Error('وقت نهاية الإذن لازم يكون بعد وقت بدايته'), { statusCode: 400 });
  }
  return { startTime: start, endTime: end };
}

const parseWeekendDays = value => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(Number).filter(day => day >= 0 && day <= 6) : [...DEFAULT_POLICY.weekend_days_json];
  } catch { return [...DEFAULT_POLICY.weekend_days_json]; }
};

async function getEffectiveHrPolicy(db, tenantId, date = cairoToday()) {
  const [[row]] = await db.query(
    `SELECT id,version,annual_leave_days,sick_leave_days,work_days_per_month,
            workday_minutes,grace_minutes,overtime_multiplier,audit_retention_days,
            weekend_days_json,effective_from,effective_to,${ATTENDANCE_POLICY_COLUMNS}
       FROM hr_policy_versions
      WHERE tenant_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
      ORDER BY effective_from DESC,version DESC LIMIT 1`,
    [tenantId, date, date]
  );
  if (!row) return DEFAULT_POLICY;
  let tiers = DEFAULT_POLICY.late_tiers_json;
  try { if (row.late_tiers_json) tiers = JSON.parse(row.late_tiers_json); } catch { /* keep the default */ }
  return { ...row, weekend_days_json: parseWeekendDays(row.weekend_days_json), late_tiers_json: tiers };
}

function calculateLeaveDays(startDate, endDate, type, policy = DEFAULT_POLICY) {
  if (!LEAVE_TYPES.has(type)) throw Object.assign(new Error('Invalid leave type'), { statusCode: 400 });
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw Object.assign(new Error('Invalid leave dates'), { statusCode: 400 });
  }
  // An إذن is half of one day, so it has to be one day.
  //
  // This returned 0.5 for any range. Approving it then wrote a HALF_DAY
  // attendance row for every working day between the two dates, and payroll
  // charges neither HALF_DAY nor a leave whose type is not UNPAID — so a
  // permission spanning a month was a month away on full pay, against half a
  // day of a balance PERMISSION does not even have. The half-day figure was
  // always describing a single day; nothing made the request agree with it.
  if (type === 'PERMISSION') {
    if (String(startDate) !== String(endDate)) {
      throw Object.assign(
        new Error('الإذن يكون ليوم واحد فقط — لأكثر من ذلك سجّل إجازة'),
        { statusCode: 400 },
      );
    }
    return 0.5;
  }
  // Arriving an hour late is not half a day off. Counting these as leave would
  // quietly drain the annual balance of anyone who ever asked to come in late,
  // so they cost nothing against it — they exist to be approved and to show up
  // in attendance, not to be deducted. Part of one day, like PERMISSION.
  if (HOUR_PERMITS.has(type)) {
    if (String(startDate) !== String(endDate)) {
      throw Object.assign(new Error('الإذن يكون ليوم واحد فقط'), { statusCode: 400 });
    }
    return 0;
  }
  const weekend = new Set(parseWeekendDays(policy.weekend_days_json));
  let days = 0;
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (type === 'MATERNITY' || !weekend.has(date.getUTCDay())) days += 1;
  }
  if (!days) throw Object.assign(new Error('Leave range contains no working days'), { statusCode: 400 });
  return days;
}

async function createLeaveRequest(db, { tenantId, staffId, type, startDate, endDate, startTime, endTime }) {
  const policy = await getEffectiveHrPolicy(db, tenantId, startDate);
  const totalDays = calculateLeaveDays(startDate, endDate, type, policy);
  const window = permitWindow(type, startTime, endTime);
  const [[staff]] = await db.query(
    'SELECT id FROM staff WHERE tenant_id=? AND id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1',
    [tenantId, staffId]
  );
  if (!staff) throw Object.assign(new Error('Active staff record not found'), { statusCode: 404 });
  const [[overlap]] = await db.query(
    `SELECT id FROM leaves
      WHERE tenant_id=? AND staff_id=? AND status IN ('PENDING','APPROVED')
        AND start_date<=? AND end_date>=? LIMIT 1`,
    [tenantId, staffId, endDate, startDate]
  );
  if (overlap) throw Object.assign(new Error('فيه طلب تاني معلق أو معتمد في نفس الأيام'), { statusCode: 409 });
  return { policy, totalDays, ...window };
}

function leaveAllowance(policy, type) {
  if (type === 'ANNUAL') return Number(policy.annual_leave_days);
  if (type === 'SICK') return Number(policy.sick_leave_days);
  return null;
}

module.exports = {
  ATTENDANCE_POLICY_COLUMNS,
  DEFAULT_POLICY, HOUR_PERMITS, LEAVE_LABELS_AR, LEAVE_TYPES, calculateLeaveDays, createLeaveRequest,
  getEffectiveHrPolicy, leaveAllowance, permitWindow,
};
