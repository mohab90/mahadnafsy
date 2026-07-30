'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');
const { createLeaveRequest, getEffectiveHrPolicy, leaveAllowance } = require('../../lib/hrPolicy');
const { writeAuditEvent } = require('../../lib/auditTrail');
const dateOnly = value => value instanceof Date
  ? value.toISOString().slice(0, 10)
  : String(value || '').slice(0, 10);
const timeMinutes = value => {
  const [hours, minutes] = String(value || '09:00').split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 9) * 60 + (Number.isFinite(minutes) ? minutes : 0);
};
const validClockTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
const validDateOnly = value => {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
};
const reportMonth = (month, year) => {
  const now = new Date();
  const m = month === undefined ? now.getMonth() + 1 : Number(month);
  const y = year === undefined ? now.getFullYear() : Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 2000 || y > 2100) return null;
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextDate = new Date(Date.UTC(y, m, 1));
  return { m, y, start, end: nextDate.toISOString().slice(0, 10) };
};
async function attendanceStart(db, tenantId, staffId, date) {
  const day = new Date(`${dateOnly(date)}T12:00:00Z`).getUTCDay();
  const [[schedule]] = await db.query(
    `SELECT start_time,grace_minutes,is_off_day FROM work_schedules
      WHERE tenant_id=? AND staff_id=? AND day_of_week=? LIMIT 1`,
    [tenantId, staffId, day]
  );
  if (schedule?.is_off_day) return { isOffDay: true, start: 0 };
  if (schedule) {
    return {
      isOffDay: false,
      start: timeMinutes(schedule.start_time) + Number(schedule.grace_minutes || 0),
    };
  }
  const policy = await getEffectiveHrPolicy(db, tenantId, dateOnly(date));
  return { isOffDay: false, start: 9 * 60 + Number(policy.grace_minutes || 0) };
}

router.get('/api/admin/hr/policies', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id,version,annual_leave_days,sick_leave_days,work_days_per_month,
              workday_minutes,grace_minutes,overtime_multiplier,audit_retention_days,weekend_days_json,
              effective_from,effective_to,created_by,created_at
         FROM hr_policy_versions WHERE tenant_id=?
        ORDER BY version DESC LIMIT 50`,
      [req.tenantId]
    );
    res.json(rows.map(row => ({
      ...row,
      weekend_days_json: (() => {
        try { return typeof row.weekend_days_json === 'string' ? JSON.parse(row.weekend_days_json) : row.weekend_days_json; }
        catch { return [5, 6]; }
      })(),
    })));
  } catch (error) {
    logger.error('[hr/policies]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/hr/policies', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const {
      annual_leave_days, sick_leave_days, work_days_per_month, workday_minutes,
      grace_minutes, overtime_multiplier, audit_retention_days, weekend_days_json, effective_from,
    } = req.body;
    const values = {
      annual: Number(annual_leave_days), sick: Number(sick_leave_days),
      workDays: Number(work_days_per_month), workMinutes: Number(workday_minutes),
      grace: Number(grace_minutes), overtime: Number(overtime_multiplier),
      retention: Number(audit_retention_days),
    };
    const weekend = Array.isArray(weekend_days_json)
      ? [...new Set(weekend_days_json.map(Number).filter(day => day >= 0 && day <= 6))]
      : [5, 6];
    if (!effective_from || Object.values(values).some(value => !Number.isFinite(value))
      || values.annual < 0 || values.annual > 365 || values.sick < 0 || values.sick > 365
      || values.workDays <= 0 || values.workDays > 31 || values.workMinutes < 60 || values.workMinutes > 1440
      || values.grace < 0 || values.grace > 240 || values.overtime < 1 || values.overtime > 5
      || values.retention < 365 || values.retention > 3650
      || !weekend.length) {
      return res.status(400).json({ error: 'Invalid HR policy values' });
    }
    await conn.beginTransaction();
    transactionStarted = true;
    const [[current]] = await conn.query(
      `SELECT id,version,effective_from FROM hr_policy_versions
        WHERE tenant_id=? ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      [req.tenantId]
    );
    if (current && dateOnly(effective_from) <= dateOnly(current.effective_from)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'تاريخ السياسة الجديدة يجب أن يكون بعد تاريخ آخر نسخة' });
    }
    if (current) {
      await conn.query(
        'UPDATE hr_policy_versions SET effective_to=DATE_SUB(?,INTERVAL 1 DAY) WHERE id=? AND tenant_id=?',
        [effective_from, current.id, req.tenantId]
      );
    }
    const id = uuidv4();
    const version = Number(current?.version || 0) + 1;
    await conn.query(
      `INSERT INTO hr_policy_versions
        (id,tenant_id,version,annual_leave_days,sick_leave_days,work_days_per_month,
         workday_minutes,grace_minutes,overtime_multiplier,audit_retention_days,
         weekend_days_json,effective_from,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, version, values.annual, values.sick, values.workDays,
        values.workMinutes, values.grace, values.overtime, values.retention, JSON.stringify(weekend),
        effective_from, req.staffRecord?.id || req.user?.uid || null]
    );
    await writeAuditEvent({
      action: 'hr.policy.created',
      entityType: 'hr_policy',
      entityId: id,
      severity: 'warning',
      metadata: { version, effective_from },
      req,
      db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, id, version });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/policies]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

router.get('/api/admin/hr/leaves', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const { status, staff_id, month, year } = req.query;
    let sql = `
      SELECT l.*, s.name AS staff_name, s.role, s.image,
             a.name AS approved_by_name
      FROM leaves l
      JOIN staff s ON s.id=l.staff_id AND s.tenant_id=l.tenant_id
      LEFT JOIN staff a ON a.id=l.approved_by AND a.tenant_id=l.tenant_id
      WHERE l.tenant_id=?
    `;
    const params = [req.tenantId];
    if (status)   { sql += ' AND l.status = ?';  params.push(status); }
    if (staff_id) { sql += ' AND l.staff_id = ?'; params.push(staff_id); }
    if (month || year) {
      const numericYear = Number(year);
      const range = year && !month
        ? (Number.isInteger(numericYear) && numericYear >= 2000 && numericYear <= 2100
          ? { start: `${numericYear}-01-01`, end: `${numericYear + 1}-01-01` }
          : null)
        : reportMonth(month, year);
      if (!range) return res.status(400).json({ error: 'Invalid month/year' });
      sql += ' AND l.start_date >= ? AND l.start_date < ?';
      params.push(range.start, range.end);
    }
    sql += ' ORDER BY l.created_at DESC LIMIT 200';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/hr/leaves — submit leave or permission request
router.post('/api/admin/hr/leaves', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { staff_id, type, start_date, end_date, reason } = req.body;
    if (!staff_id || !type || !start_date || !end_date) {
      return res.status(400).json({ error: 'staff_id, type, start_date, end_date are required' });
    }
    const { policy, totalDays } = await createLeaveRequest(pool, {
      tenantId: req.tenantId, staffId: staff_id, type,
      startDate: start_date, endDate: end_date, reason,
    });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO leaves
        (id,tenant_id,policy_id,staff_id,type,start_date,end_date,total_days,reason,status)
       VALUES (?,?,?,?,?,?,?,?,?,'PENDING')`,
      [id, req.tenantId, policy.id, staff_id, type, start_date, end_date, totalDays, reason || null]
    );

    // Notify admin
    await createNotification('info', 'طلب إجازة جديد',
      `موظف طلب ${type === 'PERMISSION' ? 'إذن' : 'إجازة'} من ${start_date} إلى ${end_date}`,
      { leave_id: id, staff_id }, req.tenantId
    );

    res.json({ ok: true, id, total_days: totalDays });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' });
  }
});

// PUT /api/admin/hr/leaves/:id/status — approve or reject leave
router.put('/api/admin/hr/leaves/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { id } = req.params;
    const { status, admin_note } = req.body;
    if (!['APPROVED','REJECTED','CANCELLED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const approver = req.staffRecord?.id || req.user?.uid || null;
    await conn.beginTransaction();
    transactionStarted = true;
    const [[leave]] = await conn.query(
      `SELECT id,policy_id,staff_id,type,start_date,end_date,total_days,status
         FROM leaves WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [id, req.tenantId]
    );
    if (!leave) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Leave not found' });
    }
    const transitions = { PENDING: ['APPROVED', 'REJECTED'], APPROVED: ['CANCELLED'] };
    if (!transitions[leave.status]?.includes(status)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: `Invalid leave transition: ${leave.status} → ${status}` });
    }
    if (status === 'APPROVED' && String(leave.staff_id) === String(approver)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'لا يجوز للموظف اعتماد إجازته بنفسه', code: 'LEAVE_SELF_APPROVAL' });
    }

    // If approved, sync attendance record
    if (status === 'APPROVED') {
      const policy = leave.policy_id
        ? (await conn.query(
          `SELECT id,annual_leave_days,sick_leave_days,weekend_days_json
             FROM hr_policy_versions WHERE tenant_id=? AND id=? LIMIT 1`,
          [req.tenantId, leave.policy_id]
        ))[0][0]
        : await getEffectiveHrPolicy(conn, req.tenantId, leave.start_date);
      const allowance = leaveAllowance(policy, leave.type);
      if (allowance !== null) {
        const [[used]] = await conn.query(
          `SELECT COALESCE(SUM(total_days),0) total
             FROM leaves
            WHERE tenant_id=? AND staff_id=? AND type=? AND status='APPROVED'
              AND id<>? AND YEAR(start_date)=YEAR(?)`,
          [req.tenantId, leave.staff_id, leave.type, leave.id, leave.start_date]
        );
        if (Number(used.total) + Number(leave.total_days) > allowance) {
          await conn.rollback(); transactionStarted = false;
          return res.status(409).json({ error: `رصيد ${leave.type} غير كافٍ`, code: 'LEAVE_BALANCE_EXCEEDED' });
        }
      }
      const [[conflict]] = await conn.query(
        `SELECT id,date,status FROM attendance_logs
          WHERE tenant_id=? AND staff_id=? AND date BETWEEN ? AND ?
            AND (leave_id IS NULL OR leave_id<>?) LIMIT 1 FOR UPDATE`,
        [req.tenantId, leave.staff_id, leave.start_date, leave.end_date, leave.id]
      );
      if (conflict) {
        await conn.rollback(); transactionStarted = false;
        return res.status(409).json({
          error: `يوجد سجل حضور متعارض بتاريخ ${dateOnly(conflict.date)}`,
          code: 'ATTENDANCE_CONFLICT',
        });
      }
      const start = new Date(`${dateOnly(leave.start_date)}T12:00:00Z`);
      const end = new Date(`${dateOnly(leave.end_date)}T12:00:00Z`);
      const weekends = new Set((() => {
        try { return JSON.parse(policy.weekend_days_json || '[5,6]').map(Number); } catch { return [5, 6]; }
      })());
      for (const date = start; date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
        if (leave.type !== 'MATERNITY' && weekends.has(date.getUTCDay())) continue;
        const attendanceStatus = leave.type === 'PERMISSION' ? 'HALF_DAY' : 'LEAVE';
        await conn.query(
          `INSERT INTO attendance_logs
            (id,tenant_id,staff_id,date,status,notes,source,leave_id)
           VALUES (UUID(),?,?,?,?,?,'MANUAL_ENTRY',?)`,
          [req.tenantId, leave.staff_id, date.toISOString().slice(0, 10), attendanceStatus,
            `إجازة معتمدة: ${leave.type}`, leave.id]
        );
      }
    } else if (status === 'CANCELLED') {
      await conn.query(
        'DELETE FROM attendance_logs WHERE tenant_id=? AND leave_id=?',
        [req.tenantId, leave.id]
      );
    }
    await conn.query(
      `UPDATE leaves SET status=?,approved_by=?,approved_at=NOW(),admin_note=?
        WHERE id=? AND tenant_id=?`,
      [status, approver, admin_note || null, id, req.tenantId]
    );
    await writeAuditEvent({
      action: `hr.leave.${status.toLowerCase()}`,
      entityType: 'leave',
      entityId: leave.id,
      severity: status === 'APPROVED' ? 'warning' : 'info',
      metadata: { from: leave.status, to: status, staff_id: leave.staff_id, total_days: leave.total_days },
      req,
      db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// POST /api/admin/hr/salary — save/update salary structure
router.post('/api/admin/hr/salary', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { staff_id, base_salary, housing_allowance, transport_allowance, food_allowance, other_fixed,
            deduction_social_insurance, deduction_tax, other_allowances_json, currency, effective_from } = req.body;
    if (!staff_id || base_salary === undefined) return res.status(400).json({ error: 'staff_id and base_salary required' });
    if (req.staffRecord?.id === staff_id) {
      return res.status(409).json({ error: 'لا يجوز تعديل هيكل راتبك بنفسك', code: 'HR_SELF_MUTATION' });
    }
    if (!Number.isFinite(Number(base_salary)) || Number(base_salary) < 0) {
      return res.status(400).json({ error: 'Invalid base salary' });
    }
    const startsOn = effective_from || new Date().toISOString().slice(0, 10);
    if (startsOn < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: 'Salary effective date cannot be in the past' });
    }
    await conn.beginTransaction();
    const [[ownedStaff]] = await conn.query(
      'SELECT id FROM staff WHERE tenant_id=? AND id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [req.tenantId, staff_id]
    );
    if (!ownedStaff) {
      await conn.rollback();
      return res.status(404).json({ error: 'Staff record not found' });
    }
    const [[latest]] = await conn.query(
      `SELECT effective_from FROM salary_structures
        WHERE tenant_id=? AND staff_id=? AND status='APPROVED'
        ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
      [req.tenantId, staff_id]
    );
    if (latest && startsOn <= dateOnly(latest.effective_from)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Salary effective date must follow the active approved structure' });
    }
    const id = uuidv4();
    const createdBy = req.staffRecord?.id || null;
    await conn.query(
      `INSERT INTO salary_structures
        (id,tenant_id,staff_id,base_salary,housing_allowance,transport_allowance,food_allowance,
         other_fixed,deduction_social_insurance,deduction_tax,other_allowances_json,currency,
         effective_from,created_by,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING')`,
      [id, req.tenantId, staff_id, base_salary, housing_allowance||0, transport_allowance||0,
       food_allowance||0, other_fixed||0, deduction_social_insurance||0, deduction_tax||0,
       other_allowances_json ? JSON.stringify(other_allowances_json) : null,
       currency||'EGP', startsOn, createdBy]
    );
    await writeAuditEvent({
      action: 'hr.salary_structure.created',
      entityType: 'staff',
      entityId: staff_id,
      severity: 'critical',
      metadata: { effective_from: startsOn, currency: currency || 'EGP' },
      req,
      db: conn,
    });
    await conn.commit();
    res.json({ ok: true, id, status: 'PENDING' });
  } catch (e) {
    await conn.rollback().catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// GET /api/admin/hr/attendance/:staffId — attendance logs for a staff member
router.put('/api/admin/hr/salary/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { status } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await conn.beginTransaction();
    transactionStarted = true;
    const [[salary]] = await conn.query(
      `SELECT id,staff_id,status,created_by,effective_from FROM salary_structures
        WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE`,
      [req.tenantId, req.params.id]
    );
    if (!salary) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Salary structure not found' });
    }
    if (salary.status !== 'PENDING') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Only pending salary structures can be reviewed' });
    }
    const actor = req.staffRecord?.id || req.user?.uid || null;
    if (!actor || [salary.staff_id, salary.created_by].map(String).includes(String(actor))) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'فصل المهام يمنع صاحب الراتب أو منشئ التعديل من اعتماده', code: 'SALARY_SOD' });
    }
    if (status === 'APPROVED') {
      await conn.query(
        `UPDATE salary_structures SET effective_to=DATE_SUB(?,INTERVAL 1 DAY)
          WHERE tenant_id=? AND staff_id=? AND id<>? AND status='APPROVED' AND effective_to IS NULL`,
        [salary.effective_from, req.tenantId, salary.staff_id, salary.id]
      );
    }
    await conn.query(
      'UPDATE salary_structures SET status=?,approved_by=?,approved_at=NOW() WHERE tenant_id=? AND id=?',
      [status, actor, req.tenantId, salary.id]
    );
    await writeAuditEvent({
      action: `hr.salary_structure.${status.toLowerCase()}`,
      entityType: 'salary_structure',
      entityId: salary.id,
      severity: 'critical',
      metadata: { staff_id: salary.staff_id },
      req,
      db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, status });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/salary/status]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

router.get('/api/admin/hr/attendance/:staffId', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const { staffId } = req.params;
    const { month, year } = req.query;
    const range = reportMonth(month, year);
    if (!range) return res.status(400).json({ error: 'month and year are invalid' });
    const [rows] = await pool.query(
      `SELECT id, staff_id, branch, date, check_in, check_out, total_hours, late_minutes,
              status, notes, source, import_batch_id, created_at, updated_at
       FROM attendance_logs WHERE staff_id=? AND tenant_id=? AND date>=? AND date<? ORDER BY date`,
      [staffId, req.tenantId, range.start, range.end]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/hr/attendance — manual attendance entry
router.post('/api/admin/hr/attendance', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { staff_id, date, check_in, check_out, status, notes } = req.body;
    if (!staff_id || !validDateOnly(date)) return res.status(400).json({ error: 'staff_id and valid date are required' });
    const VALID_STATUSES = ['PRESENT','ABSENT','LATE','HALF_DAY','HOLIDAY','REMOTE'];
    if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid attendance status' });
    if ((check_in && !validClockTime(check_in)) || (check_out && !validClockTime(check_out))) {
      return res.status(400).json({ error: 'Time must use HH:mm format' });
    }
    const safeStatus = status || 'PRESENT';
    // Calculate lateness against the employee schedule, then the tenant policy.
    let lateMin = 0;
    if (check_in) {
      const [h,m2] = check_in.split(':').map(Number);
      const minutesIn = h * 60 + m2;
      const expected = await attendanceStart(conn, req.tenantId, staff_id, date);
      if (expected.isOffDay && safeStatus !== 'REMOTE') {
        return res.status(409).json({ error: 'لا يمكن تسجيل حضور عادي في يوم راحة مجدول' });
      }
      if (minutesIn > expected.start) lateMin = minutesIn - expected.start;
    }
    let totalHours = null;
    if (check_in && check_out) {
      const [hi,mi] = check_in.split(':').map(Number);
      const [ho,mo] = check_out.split(':').map(Number);
      const duration = (ho*60+mo) - (hi*60+mi);
      if (duration < 0) return res.status(400).json({ error: 'check_out must be after check_in' });
      totalHours = Math.round(duration / 60 * 100) / 100;
    }
    await conn.beginTransaction();
    transactionStarted = true;
    const [[ownedStaff]] = await conn.query(
      'SELECT id FROM staff WHERE tenant_id=? AND id=? AND deleted_at IS NULL LIMIT 1',
      [req.tenantId, staff_id]
    );
    if (!ownedStaff) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Staff record not found' });
    }
    const [[existing]] = await conn.query(
      'SELECT leave_id FROM attendance_logs WHERE tenant_id=? AND staff_id=? AND date=? LIMIT 1 FOR UPDATE',
      [req.tenantId, staff_id, date]
    );
    if (existing?.leave_id) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(409).json({
        error: 'لا يمكن تعديل يوم مرتبط بإجازة معتمدة؛ ألغِ الإجازة من مسار الإجازات أولًا',
        code: 'LEAVE_ATTENDANCE_LOCKED',
      });
    }
    await conn.query(
      `INSERT INTO attendance_logs (id, tenant_id, staff_id, date, check_in, check_out, total_hours, late_minutes, status, notes, source)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL_ENTRY')
       ON DUPLICATE KEY UPDATE check_in=VALUES(check_in), check_out=VALUES(check_out),
         total_hours=VALUES(total_hours), late_minutes=VALUES(late_minutes),
         status=VALUES(status), notes=VALUES(notes)`,
      [req.tenantId, staff_id, date, check_in||null, check_out||null, totalHours, lateMin, safeStatus, notes||null]
    );
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// ── Staff self-service attendance (check-in / check-out) ─────────────────────
// Lets a staff member clock in/out from their own dashboard → feeds attendance_logs
// (source APP) which payroll + attendance reports already consume. This is the
// integration that was missing (attendance was admin-manual/import only).
router.get('/api/me/hr/attendance/today', requireAuth, async (req, res) => {
  try {
    const st = await _resolveStaffByUser(req);
    if (!st) return res.json({ isStaff: false });
    const [[row]] = await pool.query(
      'SELECT check_in, check_out, status, total_hours, late_minutes FROM attendance_logs WHERE staff_id=? AND tenant_id=? AND date=CURDATE() LIMIT 1', [st.id, req.tenantId]);
    res.json({ isStaff: true, staffName: st.name, today: row || null });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/me/hr/attendance/check-in', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const st = await _resolveStaffByUser(req);
    if (!st) return res.status(403).json({ error: 'not_staff' });
    const [[clock]] = await conn.query(
      "SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') work_date,DATE_FORMAT(NOW(),'%H:%i') work_time,HOUR(NOW())*60+MINUTE(NOW()) minutes_in"
    );
    const expected = await attendanceStart(conn, req.tenantId, st.id, clock.work_date);
    if (expected.isOffDay) return res.status(409).json({ error: 'اليوم مسجل كراحة في جدولك' });
    const lateMin = Number(clock.minutes_in) > expected.start ? Number(clock.minutes_in) - expected.start : 0;
    const status = lateMin > 0 ? 'LATE' : 'PRESENT';
    await conn.beginTransaction();
    transactionStarted = true;
    const [[existing]] = await conn.query(
      'SELECT check_in,status,leave_id FROM attendance_logs WHERE staff_id=? AND tenant_id=? AND date=? LIMIT 1 FOR UPDATE',
      [st.id, req.tenantId, clock.work_date]
    );
    if (existing?.leave_id || ['LEAVE', 'HOLIDAY'].includes(existing?.status)) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(409).json({
        error: 'اليوم مرتبط بإجازة معتمدة أو عطلة ولا يقبل تسجيل حضور',
        code: 'ATTENDANCE_DAY_LOCKED',
      });
    }
    await conn.query(
      `INSERT INTO attendance_logs (id, tenant_id, staff_id, date, check_in, late_minutes, status, source)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'APP')
       ON DUPLICATE KEY UPDATE
         late_minutes=IF(check_in IS NULL,VALUES(late_minutes),late_minutes),
         status=IF(check_in IS NULL OR status='ABSENT',VALUES(status),status),
         check_in=COALESCE(check_in,VALUES(check_in)),source='APP'`,
      [req.tenantId, st.id, clock.work_date, clock.work_time, lateMin, status]);
    const [[saved]] = await conn.query(
      'SELECT check_in,status,late_minutes FROM attendance_logs WHERE staff_id=? AND tenant_id=? AND date=? LIMIT 1',
      [st.id, req.tenantId, clock.work_date]
    );
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, check_in: saved.check_in, status: saved.status, late_minutes: saved.late_minutes });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});
router.post('/api/me/hr/attendance/check-out', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const st = await _resolveStaffByUser(req);
    if (!st) return res.status(403).json({ error: 'not_staff' });
    await conn.beginTransaction();
    transactionStarted = true;
    const [[clock]] = await conn.query(
      "SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') work_date,DATE_FORMAT(NOW(),'%H:%i') work_time,HOUR(NOW())*60+MINUTE(NOW()) minutes_now"
    );
    const [[row]] = await conn.query(
      'SELECT check_in,check_out,total_hours FROM attendance_logs WHERE staff_id=? AND tenant_id=? AND date=? LIMIT 1 FOR UPDATE',
      [st.id, req.tenantId, clock.work_date]
    );
    if (!row?.check_in) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'يجب تسجيل الحضور قبل الانصراف' });
    }
    const [hours, minutes] = String(row.check_in).split(':').map(Number);
    const totalHours = Math.max(0, Math.round((Number(clock.minutes_now) - (hours * 60 + minutes)) / 60 * 100) / 100);
    await conn.query(
      `UPDATE attendance_logs
          SET total_hours=IF(check_out IS NULL,?,total_hours),
              check_out=COALESCE(check_out,?),source='APP'
        WHERE staff_id=? AND tenant_id=? AND date=?`,
      [totalHours, clock.work_time, st.id, req.tenantId, clock.work_date]
    );
    const [[saved]] = await conn.query(
      'SELECT check_out,total_hours FROM attendance_logs WHERE staff_id=? AND tenant_id=? AND date=? LIMIT 1',
      [st.id, req.tenantId, clock.work_date]
    );
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, check_out: saved.check_out, total_hours: saved.total_hours });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// GET /api/admin/hr/kpi/:staffId — KPI summary for a staff member
router.get('/api/admin/hr/kpi/:staffId', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const { staffId } = req.params;
    const { month, year } = req.query;
    const range = reportMonth(month, year);
    if (!range) return res.status(400).json({ error: 'month and year are invalid' });
    const { start, end } = range;

    // Auto-calculate actuals from CRM
    const [[actuals]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM leads WHERE tenant_id=? AND assigned_sales_id=? AND created_at>=? AND created_at<?) AS leads_assigned,
        (SELECT COUNT(*) FROM leads WHERE tenant_id=? AND assigned_sales_id=? AND status IN ('closed','converted') AND updated_at>=? AND updated_at<?) AS leads_converted,
        (SELECT COUNT(*) FROM leads WHERE tenant_id=? AND assigned_sales_id=? AND status='contacted' AND updated_at>=? AND updated_at<?) AS leads_contacted,
        (SELECT COALESCE(SUM(amount_egp),0) FROM payments WHERE tenant_id=? AND staff_id=? AND status='paid' AND date>=? AND date<?) AS revenue_generated,
        (SELECT COUNT(*) FROM payments WHERE tenant_id=? AND staff_id=? AND status='paid' AND date>=? AND date<?) AS sales_count,
        (SELECT COUNT(*) FROM subscribers WHERE tenant_id=? AND assigned_sales_id=? AND created_at>=? AND created_at<?) AS subscribers_enrolled
    `, Array.from({ length: 6 }, () => [req.tenantId, staffId, start, end]).flat());

    // KPI targets
    const [targets] = await pool.query(
      `SELECT id, staff_id, metric, target_value, period, from_date, to_date, notes, set_by, created_at
       FROM kpi_targets WHERE staff_id=? AND tenant_id=? AND from_date <= ? AND to_date >= ?`,
      [staffId, req.tenantId, start, start]
    );

    // Historical (last 6 months)
    const [history] = await pool.query(`
      SELECT MONTH(date) AS month, YEAR(date) AS year,
             COUNT(*) AS sales_count, SUM(amount_egp) AS revenue
      FROM payments
      WHERE staff_id=? AND tenant_id=? AND status='paid' AND date >= DATE_SUB(CURRENT_DATE, INTERVAL 6 MONTH)
      GROUP BY YEAR(date), MONTH(date) ORDER BY YEAR(date) DESC, MONTH(date) DESC
    `, [staffId, req.tenantId]);

    // Customer-service performance for this agent (interconnects CS ↔ HR): how
    // many tickets they handled, resolution rate, first-response speed + SLA.
    const [[row]] = await pool.query(`
        SELECT COUNT(*) AS tickets_assigned,
               SUM(status IN ('resolved','closed')) AS tickets_resolved,
               AVG(CASE WHEN first_response_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, created_at, first_response_at) END) AS avg_first_response_min,
               SUM(first_response_at IS NOT NULL) AS responded,
               SUM(first_response_at IS NOT NULL AND (sla_due_at IS NULL OR first_response_at <= sla_due_at)) AS sla_met
          FROM support_tickets
         WHERE tenant_id=? AND assigned_to=? AND created_at>=? AND created_at<?`,
      [req.tenantId, staffId, start, end]);
    const cs = {
      tickets_assigned: Number(row.tickets_assigned || 0),
      tickets_resolved: Number(row.tickets_resolved || 0),
      avg_first_response_min: row.avg_first_response_min != null ? Math.round(row.avg_first_response_min) : null,
      sla_compliance: row.responded ? Math.round((row.sla_met / row.responded) * 100) : null,
    };

    res.json({ actuals, targets, history, cs });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// HR — PAYROLL
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/hr/payroll — list payroll runs
module.exports = router;
