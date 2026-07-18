'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');

router.get('/api/admin/hr/instructors/:staffId/rates', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT id, staff_id, consultation_rate_type, consultation_rate_value, lecture_rate_per_hour,
              training_rate_per_hour, currency, notes, updated_at
       FROM instructor_rates WHERE tenant_id=? AND staff_id=?`, [req.tenantId, req.params.staffId]
    );
    res.json(row || null);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/hr/instructors/:staffId/rates', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { consultation_rate_type, consultation_rate_value, lecture_rate_per_hour, training_rate_per_hour, currency, notes } = req.body;
    const [[ownedStaff]] = await pool.query(
      'SELECT id FROM staff WHERE tenant_id=? AND id=? AND deleted_at IS NULL LIMIT 1',
      [req.tenantId, req.params.staffId]
    );
    if (!ownedStaff) return res.status(404).json({ error: 'Staff record not found' });
    await pool.query(
      `INSERT INTO instructor_rates (id, tenant_id, staff_id, consultation_rate_type, consultation_rate_value, lecture_rate_per_hour, training_rate_per_hour, currency, notes)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         consultation_rate_type=VALUES(consultation_rate_type),
         consultation_rate_value=VALUES(consultation_rate_value),
         lecture_rate_per_hour=VALUES(lecture_rate_per_hour),
         training_rate_per_hour=VALUES(training_rate_per_hour),
         currency=VALUES(currency), notes=VALUES(notes), updated_at=NOW()`,
      [req.tenantId, req.params.staffId, consultation_rate_type||'per_session', consultation_rate_value||0,
       lecture_rate_per_hour||0, training_rate_per_hour||0, currency||'EGP', notes||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, staff_id, consultation_rate_type, consultation_rate_value, lecture_rate_per_hour,
              training_rate_per_hour, currency, notes, updated_at
       FROM instructor_rates WHERE tenant_id=? AND staff_id=?`, [req.tenantId, req.params.staffId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v16 — Employee Bonuses & Deductions
// ══════════════════════════════════════════════════════════════

router.get('/api/admin/hr/employees/:staffId/bonuses', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.*, c.name AS created_by_name
       FROM employee_bonuses b LEFT JOIN staff c ON c.id=b.created_by AND c.tenant_id=b.tenant_id
       WHERE b.tenant_id=? AND b.staff_id=? ORDER BY b.created_at DESC`,
      [req.tenantId, req.params.staffId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/hr/employees/:staffId/bonuses', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { type, amount, currency, reason, for_month, for_year } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const id = uuidv4();
    const [created] = await pool.query(
      `INSERT INTO employee_bonuses (id, tenant_id, staff_id, type, amount, currency, reason, for_month, for_year, created_by)
       SELECT ?,?,?,?,?,?,?,?,?,?
       FROM staff WHERE tenant_id=? AND id=? AND deleted_at IS NULL`,
      [id, req.tenantId, req.params.staffId, type||'bonus', amount, currency||'EGP', reason||null, for_month||null, for_year||null, req.staffRecord?.id||null,
       req.tenantId, req.params.staffId]
    );
    if (!created.affectedRows) return res.status(404).json({ error: 'Staff record not found' });
    const [[row]] = await pool.query(
      `SELECT id, staff_id, type, amount, currency, reason, for_month, for_year, created_by, created_at
       FROM employee_bonuses WHERE tenant_id=? AND id=?`, [req.tenantId, id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/hr/bonuses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [deleted] = await pool.query('DELETE FROM employee_bonuses WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
    if (!deleted.affectedRows) return res.status(404).json({ error: 'Bonus record not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v20 — Instructor Fees (lecture/training/consultation fees per month)
// ══════════════════════════════════════════════════════════════

// GET /api/admin/hr/instructor-fees?staffId=&month=&year=&status=
router.get('/api/admin/hr/instructor-fees', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const { staffId, month, year, status } = req.query;
    let sql = `SELECT f.*, s.name AS staff_name, c.title AS course_title
               FROM instructor_fees f
               LEFT JOIN staff s ON s.id = f.staff_id AND s.tenant_id = f.tenant_id
               LEFT JOIN courses c ON c.id = f.course_id AND c.tenant_id = f.tenant_id
               WHERE f.tenant_id = ?`;
    const params = [req.tenantId];
    if (staffId) { sql += ' AND f.staff_id = ?'; params.push(staffId); }
    if (month)   { sql += ' AND f.period_month = ?'; params.push(Number(month)); }
    if (year)    { sql += ' AND f.period_year = ?'; params.push(Number(year)); }
    if (status)  { sql += ' AND f.status = ?'; params.push(status); }
    // Non-admin staff can only see their own fees
    const isManager = req.staffRecord && ['MANAGER','ADMIN','ACCOUNTANT','DAQQI_MANAGER'].includes((req.staffRecord.role||'').toUpperCase());
    if (req.staffRecord && !req.isSuperAdmin && !isManager) {
      sql += ' AND f.staff_id = ?'; params.push(req.staffRecord.id);
    }
    sql += ' ORDER BY f.period_year DESC, f.period_month DESC, f.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/hr/instructor-fees — create a fee record
router.post('/api/admin/hr/instructor-fees', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { staff_id, course_id, daqqi_round_id, fee_type, hours, rate_per_hour, fixed_amount, currency, period_month, period_year, note } = req.body;
    if (!staff_id) return res.status(400).json({ error: 'staff_id required' });
    const total = fixed_amount
      ? Number(fixed_amount)
      : (Number(hours || 0) * Number(rate_per_hour || 0));
    const id = uuidv4();
    const [created] = await pool.query(
      `INSERT INTO instructor_fees (id, tenant_id, staff_id, course_id, daqqi_round_id, fee_type, hours, rate_per_hour, fixed_amount, total_amount, currency, period_month, period_year, note, created_by)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
       FROM staff s
       WHERE s.tenant_id=? AND s.id=? AND s.deleted_at IS NULL
         AND (? IS NULL OR EXISTS (SELECT 1 FROM courses c WHERE c.tenant_id=? AND c.id=?))`,
      [id, req.tenantId, staff_id, course_id||null, daqqi_round_id||null, fee_type||'lecture',
       hours||null, rate_per_hour||null, fixed_amount||null, total,
       currency||'EGP', period_month||null, period_year||null, note||null, req.user?.id||null,
       req.tenantId, staff_id, course_id||null, req.tenantId, course_id||null]
    );
    if (!created.affectedRows) return res.status(404).json({ error: 'Staff or course not found in tenant' });
    const [[row]] = await pool.query(
      `SELECT id, staff_id, course_id, daqqi_round_id, fee_type, hours, rate_per_hour, fixed_amount,
              total_amount, currency, period_month, period_year, status, note, created_by, created_at
       FROM instructor_fees WHERE tenant_id=? AND id=?`, [req.tenantId, id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/hr/instructor-fees/:id — update status (approve/mark paid)
router.patch('/api/admin/hr/instructor-fees/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { status, note } = req.body;
    const allowed = ['pending','approved','paid'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    await conn.beginTransaction();
    const [[current]] = await conn.query(
      `SELECT id, status FROM instructor_fees
       WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE`,
      [req.tenantId, req.params.id]
    );
    if (!current) {
      await conn.rollback();
      return res.status(404).json({ error: 'Instructor fee not found' });
    }
    if (status && status !== current.status) {
      const transitions = { pending: ['approved'], approved: ['paid'], paid: [] };
      if (!transitions[String(current.status).toLowerCase()]?.includes(status)) {
        await conn.rollback();
        return res.status(409).json({ error: `Invalid fee transition: ${current.status} -> ${status}` });
      }
    }
    const sets = [];
    const params = [];
    if (status) { sets.push('status=?'); params.push(status); }
    if (note !== undefined) { sets.push('note=?'); params.push(note); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    params.push(req.tenantId, req.params.id);
    await conn.query(`UPDATE instructor_fees SET ${sets.join(',')} WHERE tenant_id=? AND id=?`, params);
    const [[row]] = await conn.query(
      `SELECT id, staff_id, course_id, daqqi_round_id, fee_type, hours, rate_per_hour, fixed_amount,
              total_amount, currency, period_month, period_year, status, note, created_by, created_at
       FROM instructor_fees WHERE tenant_id=? AND id=?`, [req.tenantId, req.params.id]
    );
    await conn.commit();
    res.json(row);
  } catch (e) {
    await conn.rollback().catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// DELETE /api/admin/hr/instructor-fees/:id
router.delete('/api/admin/hr/instructor-fees/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [[fee]] = await pool.query(
      'SELECT status FROM instructor_fees WHERE tenant_id=? AND id=? LIMIT 1',
      [req.tenantId, req.params.id]
    );
    if (!fee) return res.status(404).json({ error: 'Instructor fee not found' });
    if (String(fee.status).toLowerCase() === 'paid') {
      return res.status(409).json({ error: 'Paid instructor fees cannot be deleted' });
    }
    await pool.query('DELETE FROM instructor_fees WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/staff/me/leaves', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(403).json({ error: 'Staff record not found' });
    const { type, start_date, end_date, reason } = req.body;
    if (!type || !start_date || !end_date) return res.status(400).json({ error: 'type, start_date, end_date required' });
    const start = new Date(start_date);
    const end   = new Date(end_date);
    if (isNaN(start) || isNaN(end) || end < start) return res.status(400).json({ error: 'Invalid dates' });
    const totalDays = Math.ceil((end - start) / 86400000) + 1;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO leave_requests (id, tenant_id, staff_id, type, start_date, end_date, days, reason, status)
       VALUES (?,?,?,?,?,?,?,?,'PENDING')`,
      [id, req.tenantId, staff.id, type, start_date, end_date, totalDays, reason || null]
    );
    const [[row]] = await pool.query(
      'SELECT id, staff_id, type, start_date, end_date, days AS total_days, reason, status FROM leave_requests WHERE tenant_id=? AND id=?',
      [req.tenantId, id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/staff/me/payslip', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(404).json({ error: 'Staff record not found' });
    const m = Number(req.query.month) || new Date().getMonth() + 1;
    const y = Number(req.query.year)  || new Date().getFullYear();
    const [[item]] = await pool.query(`
      SELECT pi.*, pr.month, pr.year, pr.status AS run_status,
             s.name AS staff_name, s.role, d.name AS department_name
      FROM payroll_items pi
      JOIN payroll_runs pr ON pr.id=pi.payroll_run_id AND pr.tenant_id=pi.tenant_id
      JOIN staff s ON s.id=pi.staff_id AND s.tenant_id=pi.tenant_id
      LEFT JOIN hr_departments d ON d.id=s.department_id AND d.tenant_id=pi.tenant_id
      WHERE pi.tenant_id=? AND pi.staff_id=? AND pr.month=? AND pr.year=? AND pr.status IN ('APPROVED','PAID')
      LIMIT 1
    `, [req.tenantId, staff.id, m, y]);
    if (!item) return res.json(null);
    res.json(item);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/staff/me/commissions', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(404).json({ error: 'Staff record not found' });
    const m = Number(req.query.month) || null;
    const y = Number(req.query.year)  || null;
    let sql = `SELECT c.id, c.payment_amount, c.commission_amount, c.month, c.year,
                      c.status, c.created_at, s.name AS client_name
               FROM crm_commissions c
               LEFT JOIN subscribers s ON s.id=c.client_id AND s.tenant_id=c.tenant_id
               WHERE c.tenant_id=? AND c.staff_id=?`;
    const params = [req.tenantId, staff.id];
    if (m) { sql += ' AND c.month=?'; params.push(m); }
    if (y) { sql += ' AND c.year=?';  params.push(y); }
    sql += ' ORDER BY c.created_at DESC LIMIT 200';
    const [rows] = await pool.query(sql, params);
    const total = rows.reduce((s, r) => s + parseFloat(r.commission_amount || 0), 0);
    res.json({ commissions: rows, total_pending: parseFloat(total.toFixed(2)) });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/staff/me/schedule', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(403).json({ error: 'Not a staff member' });
    const [rows] = await pool.query(
      'SELECT id, staff_id, day_of_week, start_time, end_time, grace_minutes, is_off_day FROM work_schedules WHERE tenant_id=? AND staff_id=? ORDER BY day_of_week',
      [req.tenantId, staff.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/staff/me/appraisals', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(403).json({ error: 'Not a staff member' });
    const [rows] = await pool.query(
      `SELECT id, staff_id, reviewer_email, period_month, period_year, kpi_scores, overall_score,
              grade, notes, status, created_at, updated_at
       FROM performance_appraisals WHERE tenant_id=? AND staff_id=? ORDER BY period_year DESC, period_month DESC`,
      [req.tenantId, staff.id]
    );
    res.json(rows.map(r => ({ ...r, kpi_scores: tryJson(r.kpi_scores, []) })));
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Monthly Attendance Report ───────────────────────────────────
// GET /api/admin/hr/attendance-report?month=YYYY-MM
// Returns per-staff attendance summary for the given month:
// present days, absence days, late days, leave days, leave balance usage.
// ══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/hr/attendance-report', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const month = (req.query.month || new Date().toISOString().slice(0, 7));
    const [y, m] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const monthEnd   = new Date(y, m, 1).toISOString().slice(0, 10); // first day of next month

    // All active staff
    const [staff] = await pool.query(
      `SELECT id, name, email, role, employment_type
       FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL ORDER BY name ASC`,
      [req.tenantId]
    );

    // Absence records for the month
    const [absences] = await pool.query(
      `SELECT staff_id, type, date, COUNT(*) AS cnt
       FROM staff_absences
       WHERE tenant_id=? AND date >= ? AND date < ?
       GROUP BY staff_id, type, date`,
      [req.tenantId, monthStart, monthEnd]
    ).catch(() => [[]]);

    // Leave requests approved for the month
    const [leaves] = await pool.query(
      `SELECT staff_id, leave_type, status,
              DATEDIFF(LEAST(end_date, ?), GREATEST(start_date, ?)) + 1 AS days_in_month
       FROM leave_requests
       WHERE tenant_id=? AND status = 'APPROVED'
         AND start_date < ? AND end_date >= ?`,
      [monthEnd, monthStart, req.tenantId, monthEnd, monthStart]
    ).catch(() => [[]]);

    // Working days in month (Mon–Fri, rough estimate)
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDow    = new Date(y, m - 1, 1).getDay(); // 0=Sun
    let workDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = (firstDow + d - 1) % 7;
      if (dow !== 5 && dow !== 6) workDays++; // exclude Fri+Sat (Egyptian weekend)
    }

    const report = staff.map(s => {
      const myAbsences = absences.filter(a => a.staff_id === s.id);
      const absenceDays = myAbsences.filter(a => a.type === 'absence').length;
      const sickDays    = myAbsences.filter(a => a.type === 'sick').length;
      const lateDays    = myAbsences.filter(a => a.type === 'late').length;
      const myLeaves    = leaves.filter(l => l.staff_id === s.id);
      const leaveDays   = myLeaves.reduce((acc, l) => acc + Math.max(0, Number(l.days_in_month)), 0);
      const presentDays = Math.max(0, workDays - absenceDays - sickDays - leaveDays);
      const attendancePct = workDays > 0 ? Math.round((presentDays / workDays) * 100) : 100;
      return {
        staffId:       s.id,
        name:          s.name,
        role:          s.role,
        employmentType: s.employment_type || 'full_time',
        workDays,
        presentDays,
        absenceDays,
        sickDays,
        lateDays,
        leaveDays,
        attendancePct,
      };
    });

    res.json({ month, workDays, staff: report });
  } catch (e) { logger.error('[hr/attendance-report]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
