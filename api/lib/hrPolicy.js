'use strict';

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
  weekend_days_json: [5, 6],
});
const LEAVE_TYPES = new Set(['ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'EMERGENCY', 'PERMISSION', 'OTHER']);

const parseWeekendDays = value => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(Number).filter(day => day >= 0 && day <= 6) : [5, 6];
  } catch { return [5, 6]; }
};

async function getEffectiveHrPolicy(db, tenantId, date = new Date().toISOString().slice(0, 10)) {
  const [[row]] = await db.query(
    `SELECT id,version,annual_leave_days,sick_leave_days,work_days_per_month,
            workday_minutes,grace_minutes,overtime_multiplier,audit_retention_days,
            weekend_days_json,effective_from,effective_to
       FROM hr_policy_versions
      WHERE tenant_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
      ORDER BY effective_from DESC,version DESC LIMIT 1`,
    [tenantId, date, date]
  );
  return row ? { ...row, weekend_days_json: parseWeekendDays(row.weekend_days_json) } : DEFAULT_POLICY;
}

function calculateLeaveDays(startDate, endDate, type, policy = DEFAULT_POLICY) {
  if (!LEAVE_TYPES.has(type)) throw Object.assign(new Error('Invalid leave type'), { statusCode: 400 });
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw Object.assign(new Error('Invalid leave dates'), { statusCode: 400 });
  }
  if (type === 'PERMISSION') return 0.5;
  const weekend = new Set(parseWeekendDays(policy.weekend_days_json));
  let days = 0;
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (type === 'MATERNITY' || !weekend.has(date.getUTCDay())) days += 1;
  }
  if (!days) throw Object.assign(new Error('Leave range contains no working days'), { statusCode: 400 });
  return days;
}

async function createLeaveRequest(db, { tenantId, staffId, type, startDate, endDate, reason }) {
  const policy = await getEffectiveHrPolicy(db, tenantId, startDate);
  const totalDays = calculateLeaveDays(startDate, endDate, type, policy);
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
  if (overlap) throw Object.assign(new Error('Overlapping leave request already exists'), { statusCode: 409 });
  return { policy, totalDays };
}

function leaveAllowance(policy, type) {
  if (type === 'ANNUAL') return Number(policy.annual_leave_days);
  if (type === 'SICK') return Number(policy.sick_leave_days);
  return null;
}

module.exports = {
  DEFAULT_POLICY, LEAVE_TYPES, calculateLeaveDays, createLeaveRequest,
  getEffectiveHrPolicy, leaveAllowance,
};
