'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');

router.get('/api/admin/hr/reports/summary', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const m = Number(req.query.month) || new Date().getMonth() + 1;
    const y = Number(req.query.year)  || new Date().getFullYear();

    const [[headcount]] = await pool.query(`
      SELECT COUNT(*) AS total, SUM(is_active) AS active,
        SUM(CASE WHEN employment_type='full_time' THEN 1 ELSE 0 END) AS full_time,
        SUM(CASE WHEN employment_type='part_time' THEN 1 ELSE 0 END) AS part_time
      FROM staff
      WHERE tenant_id=? AND deleted_at IS NULL
    `, [req.tenantId]);

    const [[salStats]] = await pool.query(`
      SELECT AVG(ss.base_salary) AS avg_base,
        SUM(ss.base_salary + COALESCE(ss.housing_allowance,0) + COALESCE(ss.transport_allowance,0)) AS total_monthly
      FROM salary_structures ss
      JOIN staff s ON s.id=ss.staff_id AND s.tenant_id=ss.tenant_id AND s.is_active=1 AND s.deleted_at IS NULL
      WHERE ss.tenant_id=? AND ss.effective_to IS NULL
    `, [req.tenantId]);

    const [[leaveStats]] = await pool.query(`
      SELECT COUNT(*) AS total_requests,
        SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN MONTH(start_date)=? AND YEAR(start_date)=? THEN days ELSE 0 END) AS days_this_month
      FROM leave_requests
      WHERE tenant_id=?
    `, [m, y, req.tenantId]);

    const [[attStats]] = await pool.query(`
      SELECT COUNT(*) AS total_logs,
        SUM(CASE WHEN MONTH(date)=? AND YEAR(date)=? THEN 1 ELSE 0 END) AS this_month,
        AVG(late_minutes) AS avg_late_minutes
      FROM attendance_logs WHERE tenant_id=? AND MONTH(date)=? AND YEAR(date)=?
    `, [m, y, req.tenantId, m, y]);

    const [[recruitStats]] = await pool.query(`
      SELECT COUNT(*) AS open_jobs,
        (SELECT COUNT(*) FROM job_applicants WHERE tenant_id=? AND stage NOT IN ('hired','rejected')) AS active_applicants,
        (SELECT COUNT(*) FROM job_applicants WHERE tenant_id=? AND stage='hired') AS hired_total
      FROM job_postings WHERE tenant_id=? AND status='open'
    `, [req.tenantId, req.tenantId, req.tenantId]);

    const [[onboardStats]] = await pool.query(`
      SELECT COUNT(*) AS in_progress, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed
      FROM employee_onboarding WHERE tenant_id=? AND status IN ('in_progress','completed')
    `, [req.tenantId]);

    res.json({ headcount, salStats, leaveStats, attStats, recruitStats, onboardStats });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/hr/reports/payroll-trend', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT year, month, SUM(net_salary) AS total_net, SUM(total_allowances) AS total_allowances,
        COUNT(*) AS employee_count, status
      FROM payroll_runs pr
      JOIN payroll_items pi ON pi.payroll_run_id=pr.id AND pi.tenant_id=pr.tenant_id
      WHERE pr.tenant_id=? AND pr.status IN ('APPROVED','PAID') AND pr.created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY pr.id ORDER BY pr.year, pr.month
    `, [req.tenantId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/hr/reports/department-stats', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.id, d.name, COUNT(s.id) AS headcount,
        AVG(ss.base_salary) AS avg_salary,
        SUM(ss.base_salary) AS total_salary
      FROM hr_departments d
      LEFT JOIN staff s ON s.department_id=d.id AND s.tenant_id=d.tenant_id AND s.is_active=1 AND s.deleted_at IS NULL
      LEFT JOIN salary_structures ss ON ss.staff_id=s.id AND ss.tenant_id=d.tenant_id AND ss.effective_to IS NULL
      WHERE d.tenant_id=?
      GROUP BY d.id ORDER BY headcount DESC
    `, [req.tenantId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// Staff Self-Service — HR data for logged-in staff member
// ══════════════════════════════════════════════════════════════

router.get('/api/staff/me/hr', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(404).json({ error: 'Staff record not found' });
    const m = Number(req.query.month) || new Date().getMonth() + 1;
    const y = Number(req.query.year)  || new Date().getFullYear();

    const [[profile]] = await pool.query(`
      SELECT s.id, s.name, s.role, s.image, s.joined_at AS hire_date,
        s.employment_type, d.name AS department_name,
        ss.base_salary, ss.housing_allowance, ss.transport_allowance, ss.commission_rate
      FROM staff s
      LEFT JOIN hr_departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id
      LEFT JOIN salary_structures ss ON ss.staff_id=s.id AND ss.tenant_id=s.tenant_id AND ss.effective_to IS NULL
      WHERE s.tenant_id=? AND s.id=? AND s.deleted_at IS NULL
    `, [req.tenantId, staff.id]);

    const [leaves] = await pool.query(`
      SELECT id, type, start_date, end_date, days AS total_days, status, reason, created_at
      FROM leave_requests WHERE tenant_id=? AND staff_id=? ORDER BY created_at DESC LIMIT 20
    `, [req.tenantId, staff.id]);

    const [attendance] = await pool.query(`
      SELECT date, check_in, check_out, late_minutes, status, notes
      FROM attendance_logs WHERE tenant_id=? AND staff_id=? AND MONTH(date)=? AND YEAR(date)=?
      ORDER BY date
    `, [req.tenantId, staff.id, m, y]);

    const [payslips] = await pool.query(`
      SELECT pi.net_salary, pi.base_salary, pi.total_allowances, pi.commission, pi.bonus,
        pi.late_deductions, pi.absence_deductions, pi.advance_deductions,
        pr.month, pr.year, pr.status
      FROM payroll_items pi
      JOIN payroll_runs pr ON pr.id=pi.payroll_run_id AND pr.tenant_id=pi.tenant_id
      WHERE pi.tenant_id=? AND pi.staff_id=? AND pr.status IN ('APPROVED','PAID')
      ORDER BY pr.year DESC, pr.month DESC LIMIT 6
    `, [req.tenantId, staff.id]);

    res.json({ profile, leaves, attendance, payslips });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v15 — Salary Advance Requests
// ══════════════════════════════════════════════════════════════

// List advances (admin: all, staff: own)
module.exports = router;
