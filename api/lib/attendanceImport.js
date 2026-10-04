'use strict';

// A month's fingerprint punches → attendance_logs, under the company policy.
//
// Matching: the employee's number on the device (staff.biometric_user_no),
// then the name exactly as written in the system. Who is judged: everyone the
// sheet matched, and everyone with a device number set — an employee on the
// device with no punch all month was absent all month. Employees with no
// device number who are not in the sheet (remote staff) are left alone.
//
// Days already decided stay as they are: an approved leave (leave_id) and a
// day HR entered by hand (MANUAL_ENTRY). Re-uploading the same month replaces
// the imported days only.

const { uuidv4 } = require('./id');
const { cairoToday } = require('./dates');
const { getEffectiveHrPolicy } = require('./hrPolicy');
const { evaluateMonth } = require('./attendancePolicy');

const foldName = value => String(value || '').trim().replace(/\s+/g, ' ').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
const dateOnly = value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10));

/**
 * @param {object} db      pool or connection
 * @param {object} args    { tenantId, month: 'YYYY-MM', punches, actorId, filename, dryRun }
 */
async function importAttendanceMonth(db, { tenantId, month, punches, actorId = null, filename = null, dryRun = false, today = cairoToday() }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) {
    throw Object.assign(new Error('اختار الشهر'), { statusCode: 400 });
  }
  const monthStart = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (monthStart > today) throw Object.assign(new Error('الشهر ده لسه ما بدأش'), { statusCode: 400 });

  const [staff] = await db.query(
    `SELECT id, name, biometric_user_no, COALESCE(hire_date, joined_at) AS hired
       FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL`, [tenantId]);
  const byBio = new Map(staff.filter(s => s.biometric_user_no).map(s => [String(s.biometric_user_no).trim(), s]));
  const byName = new Map();
  for (const s of staff) {
    const key = foldName(s.name);
    byName.set(key, byName.has(key) ? null : s); // two people with one name match neither
  }

  const perStaff = new Map();
  const unmatched = new Map();
  for (const punch of punches) {
    const who = (punch.bioNo && byBio.get(String(punch.bioNo))) || (punch.name && byName.get(foldName(punch.name))) || null;
    if (!who) {
      const key = `${punch.bioNo || ''}|${punch.name || ''}`;
      const entry = unmatched.get(key) || { bioNo: punch.bioNo || null, name: punch.name || null, punches: 0 };
      entry.punches += 1;
      unmatched.set(key, entry);
      continue;
    }
    const days = perStaff.get(who.id) || {};
    (days[punch.date] ||= []).push(punch.time);
    perStaff.set(who.id, days);
  }
  // On the device with not a punch all month: absent all month.
  for (const s of staff) if (s.biometric_user_no && !perStaff.has(s.id)) perStaff.set(s.id, {});

  const policy = await getEffectiveHrPolicy(db, tenantId, monthStart);
  const ids = [...perStaff.keys()];
  const [decided] = ids.length ? await db.query(
    `SELECT staff_id, date FROM attendance_logs
      WHERE tenant_id=? AND staff_id IN (?) AND date BETWEEN ? AND ?
        AND (leave_id IS NOT NULL OR source='MANUAL_ENTRY')`, [tenantId, ids, monthStart, monthEnd]) : [[]];
  const [permits] = ids.length ? await db.query(
    `SELECT staff_id, type, start_date, start_time, end_time FROM leaves
      WHERE tenant_id=? AND staff_id IN (?) AND status='APPROVED' AND type IN ('LATE_PERMIT','EARLY_LEAVE')
        AND start_date BETWEEN ? AND ?`, [tenantId, ids, monthStart, monthEnd]) : [[]];

  const lastDate = monthEnd < today ? monthEnd : today;
  const staffById = new Map(staff.map(s => [s.id, s]));
  const results = [];
  for (const [staffId, punchesByDate] of perStaff) {
    const who = staffById.get(staffId);
    const hired = who.hired ? dateOnly(who.hired) : null;
    const { days, summary } = evaluateMonth({
      policy, month, punches: punchesByDate,
      approvedPermits: permits.filter(p => p.staff_id === staffId)
        .map(p => ({ date: dateOnly(p.start_date), type: p.type, startTime: p.start_time, endTime: p.end_time })),
      skipDates: new Set(decided.filter(d => d.staff_id === staffId).map(d => dateOnly(d.date))),
      firstDate: hired && hired > monthStart ? hired : monthStart,
      lastDate,
    });
    results.push({ staffId, name: who.name, biometricNo: who.biometric_user_no || null, days, summary });
  }

  const report = {
    month, filename, dryRun,
    employees: results.map(r => ({ staffId: r.staffId, name: r.name, biometricNo: r.biometricNo, ...r.summary }))
      .sort((a, b) => b.deductionDays - a.deductionDays || b.absent - a.absent || a.name.localeCompare(b.name)),
    unmatched: [...unmatched.values()].sort((a, b) => b.punches - a.punches),
    punchesRead: punches.length,
    policy: { start: policy.work_start_time || '11:00', end: policy.work_end_time || '18:30', version: policy.version || null },
  };
  if (dryRun) return { ...report, days: results.map(r => ({ staffId: r.staffId, name: r.name, days: r.days })) };

  const batchId = uuidv4();
  let written = 0;
  for (const r of results) {
    for (const d of r.days) {
      const hours = d.checkIn && d.checkOut
        ? Math.max(0, (toMin(d.checkOut) - toMin(d.checkIn)) / 60) : null;
      await db.query(
        `INSERT INTO attendance_logs
           (id, tenant_id, staff_id, date, check_in, check_out, total_hours, late_minutes, early_leave_minutes,
            deduction_days, permit_used, punches_json, review_flag, status, source, import_batch_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'FINGERPRINT_IMPORT', ?)
         ON DUPLICATE KEY UPDATE
           check_in=VALUES(check_in), check_out=VALUES(check_out), total_hours=VALUES(total_hours),
           late_minutes=VALUES(late_minutes), early_leave_minutes=VALUES(early_leave_minutes),
           deduction_days=VALUES(deduction_days), permit_used=VALUES(permit_used), punches_json=VALUES(punches_json),
           review_flag=VALUES(review_flag), status=VALUES(status), source='FINGERPRINT_IMPORT',
           import_batch_id=VALUES(import_batch_id)`,
        [uuidv4(), tenantId, r.staffId, d.date, d.checkIn, d.checkOut,
          hours == null ? null : Math.round(hours * 100) / 100, d.lateMinutes, d.earlyLeaveMinutes,
          d.deductionDays, d.permit, JSON.stringify(d.punches), d.flag, d.status, batchId]);
      written += 1;
    }
  }
  await db.query(
    `INSERT INTO attendance_import_batches (id, tenant_id, filename, month, year, rows_total, rows_ok, rows_error, errors_json, imported_by, imported_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
    [batchId, tenantId, String(filename || 'sheet').slice(0, 255), m, y, punches.length,
      punches.length - report.unmatched.reduce((s, u) => s + u.punches, 0),
      report.unmatched.reduce((s, u) => s + u.punches, 0), JSON.stringify({ unmatched: report.unmatched.slice(0, 200) }), actorId]);
  return { ...report, batchId, daysWritten: written };
}

const toMin = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

module.exports = { importAttendanceMonth, foldName };
