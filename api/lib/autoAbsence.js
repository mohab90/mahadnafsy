'use strict';

const { getTenantSetting } = require('./tenantSettings');
const { cairoToday, addDaysToDateOnly } = require('./dates');

/**
 * Marks the day before as ABSENT for staff who had a working day and left no
 * record of any kind — OFF by default, switched on per tenant (setting
 * 'hr_auto_absence').
 *
 * Absence is only ever deducted from a row marked ABSENT, and nothing wrote one
 * on its own, so an employee who never checked in calculated exactly like one who
 * attended: the deduction depended on HR remembering to enter it. Doing this
 * automatically is a pay decision (it docks salary), so it is opt-in, and it only
 * considers people who HAVE a schedule — someone with no work_schedules rows has
 * never been asked to check in, and is left alone. A day with any row at all
 * (present, late, leave, holiday, a manual entry) is never touched, so approved
 * leave and holidays cannot become absences.
 */
async function markAutoAbsences({ pool, tenantId, date = null }) {
  const setting = await getTenantSetting('hr_auto_absence', { tenantId, fallback: {} }) || {};
  if (setting.enabled !== true) return { enabled: false, marked: 0 };
  const day = date || addDaysToDateOnly(cairoToday(), -1);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const [result] = await pool.query(
    `INSERT IGNORE INTO attendance_logs (id, tenant_id, staff_id, date, status, notes, source)
     SELECT UUID(), s.tenant_id, s.id, ?, 'ABSENT', 'غياب تلقائي — لم يُسجَّل حضور ولا إجازة', 'MANUAL_ENTRY'
       FROM staff s
       JOIN work_schedules w ON w.tenant_id=s.tenant_id AND w.staff_id=s.id AND w.day_of_week=? AND w.is_off_day=0
      WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL
        AND DATE(COALESCE(s.joined_at, s.created_at)) <= ?
        AND NOT EXISTS (SELECT 1 FROM attendance_logs a WHERE a.tenant_id=s.tenant_id AND a.staff_id=s.id AND a.date=?)`,
    [day, weekday, tenantId, day, day],
  );
  return { enabled: true, date: day, marked: result.affectedRows || 0 };
}

module.exports = { markAutoAbsences };
