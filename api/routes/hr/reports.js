'use strict';
const { Router } = require('express');
const router = Router();
const { logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');

router.get('/api/admin/hr/reports/summary', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const m = Number(req.query.month) || new Date().getMonth() + 1;
    const y = Number(req.query.year)  || new Date().getFullYear();

    const [[headcount]] = await pool.query(`
      SELECT COUNT(*) AS total, SUM(is_active) AS active,
        SUM(CASE WHEN employment_type='full_time' THEN 1 ELSE 0 END) AS full_time,
        SUM(CASE WHEN employment_type='part_time' THEN 1 ELSE 0 END) AS part_time
      FROM staff
    `);

    const [[salStats]] = await pool.query(`
      SELECT AVG(ss.base_salary) AS avg_base,
        SUM(ss.base_salary + COALESCE(ss.housing_allowance,0) + COALESCE(ss.transport_allowance,0)) AS total_monthly
      FROM salary_structures ss
      JOIN staff s ON s.id=ss.staff_id AND s.is_active=1
      WHERE ss.effective_to IS NULL
    `);

    const [[leaveStats]] = await pool.query(`
      SELECT COUNT(*) AS total_requests,
        SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN MONTH(start_date)=? AND YEAR(start_date)=? THEN total_days ELSE 0 END) AS days_this_month
      FROM leave_requests
    `, [m, y]);

    const [[attStats]] = await pool.query(`
      SELECT COUNT(*) AS total_logs,
        SUM(CASE WHEN MONTH(date)=? AND YEAR(date)=? THEN 1 ELSE 0 END) AS this_month,
        AVG(late_minutes) AS avg_late_minutes
      FROM attendance_logs WHERE MONTH(date)=? AND YEAR(date)=?
    `, [m, y, m, y]);

    const [[recruitStats]] = await pool.query(`
      SELECT COUNT(*) AS open_jobs,
        (SELECT COUNT(*) FROM job_applicants WHERE stage NOT IN ('hired','rejected')) AS active_applicants,
        (SELECT COUNT(*) FROM job_applicants WHERE stage='hired') AS hired_total
      FROM job_postings WHERE status='open'
    `);

    const [[onboardStats]] = await pool.query(`
      SELECT COUNT(*) AS in_progress, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed
      FROM employee_onboarding WHERE status IN ('in_progress','completed')
    `);

    res.json({ headcount, salStats, leaveStats, attStats, recruitStats, onboardStats });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/hr/reports/payroll-trend', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT year, month, SUM(net_salary) AS total_net, SUM(total_allowances) AS total_allowances,
        COUNT(*) AS employee_count, status
      FROM payroll_runs pr
      JOIN payroll_items pi ON pi.payroll_run_id=pr.id
      WHERE pr.status IN ('APPROVED','PAID') AND pr.created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY pr.id ORDER BY pr.year, pr.month
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/hr/reports/department-stats', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.id, d.name, COUNT(s.id) AS headcount,
        AVG(ss.base_salary) AS avg_salary,
        SUM(ss.base_salary) AS total_salary
      FROM hr_departments d
      LEFT JOIN staff s ON s.department_id=d.id AND s.is_active=1
      LEFT JOIN salary_structures ss ON ss.staff_id=s.id AND ss.effective_to IS NULL
      GROUP BY d.id ORDER BY headcount DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// Staff Self-Service — HR data for logged-in staff member
// ══════════════════════════════════════════════════════════════

router.get('/api/staff/me/hr', requireAuth, async (req, res) => {
  try {
    const staffId = await getStaffIdByEmail(req.user?.email);
    if (!staffId) return res.status(404).json({ error: 'Staff record not found' });
    const m = Number(req.query.month) || new Date().getMonth() + 1;
    const y = Number(req.query.year)  || new Date().getFullYear();

    const [[profile]] = await pool.query(`
      SELECT s.id, s.name, s.role, s.image, s.joined_at AS hire_date,
        s.employment_type, d.name AS department_name,
        ss.base_salary, ss.housing_allowance, ss.transport_allowance, ss.commission_rate
      FROM staff s
      LEFT JOIN hr_departments d ON d.id=s.department_id
      LEFT JOIN salary_structures ss ON ss.staff_id=s.id AND ss.effective_to IS NULL
      WHERE s.id=?
    `, [staffId]);

    const [leaves] = await pool.query(`
      SELECT id, type, start_date, end_date, total_days, status, reason, created_at
      FROM leave_requests WHERE staff_id=? ORDER BY created_at DESC LIMIT 20
    `, [staffId]);

    const [attendance] = await pool.query(`
      SELECT date, check_in, check_out, late_minutes, status, notes
      FROM attendance_logs WHERE staff_id=? AND MONTH(date)=? AND YEAR(date)=?
      ORDER BY date
    `, [staffId, m, y]);

    const [payslips] = await pool.query(`
      SELECT pi.net_salary, pi.base_salary, pi.total_allowances, pi.commission, pi.bonus,
        pi.late_deductions, pi.absence_deductions, pi.advance_deductions,
        pr.month, pr.year, pr.status
      FROM payroll_items pi
      JOIN payroll_runs pr ON pr.id=pi.payroll_run_id
      WHERE pi.staff_id=? AND pr.status IN ('APPROVED','PAID')
      ORDER BY pr.year DESC, pr.month DESC LIMIT 6
    `, [staffId]);

    res.json({ profile, leaves, attendance, payslips });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v15 — Salary Advance Requests
// ══════════════════════════════════════════════════════════════

// List advances (admin: all, staff: own)
module.exports = router;
