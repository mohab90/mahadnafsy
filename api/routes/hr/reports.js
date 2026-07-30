'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');
const { getEffectiveHrPolicy } = require('../../lib/hrPolicy');

router.get('/api/admin/hr/reports/summary', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const m = Number(req.query.month) || new Date().getMonth() + 1;
    const y = Number(req.query.year)  || new Date().getFullYear();

    const [[headcount]] = await pool.query(`
      SELECT COUNT(*) AS total, SUM(is_active) AS active,
        SUM(CASE WHEN UPPER(employment_type)='FULL_TIME' THEN 1 ELSE 0 END) AS full_time,
        SUM(CASE WHEN UPPER(employment_type)='PART_TIME' THEN 1 ELSE 0 END) AS part_time
      FROM staff
      WHERE tenant_id=? AND deleted_at IS NULL
    `, [req.tenantId]);

    const [[salStats]] = await pool.query(`
      SELECT AVG(ss.base_salary) AS avg_base,
        SUM(ss.base_salary + COALESCE(ss.housing_allowance,0) + COALESCE(ss.transport_allowance,0)) AS total_monthly
      FROM salary_structures ss
      JOIN staff s ON s.id=ss.staff_id AND s.tenant_id=ss.tenant_id AND s.is_active=1 AND s.deleted_at IS NULL
      WHERE ss.tenant_id=? AND ss.status='APPROVED'
        AND ss.effective_from<=CURRENT_DATE
        AND (ss.effective_to IS NULL OR ss.effective_to>=CURRENT_DATE)
        AND NOT EXISTS (
          SELECT 1 FROM salary_structures newer
           WHERE newer.tenant_id=ss.tenant_id AND newer.staff_id=ss.staff_id
             AND newer.status='APPROVED' AND newer.effective_from<=CURRENT_DATE
             AND (newer.effective_to IS NULL OR newer.effective_to>=CURRENT_DATE)
             AND newer.effective_from>ss.effective_from
        )
    `, [req.tenantId]);

    const [[leaveStats]] = await pool.query(`
      SELECT COUNT(*) AS total_requests,
        SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status='APPROVED' AND MONTH(start_date)=? AND YEAR(start_date)=?
                 THEN total_days ELSE 0 END) AS days_this_month
      FROM leaves
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
      LEFT JOIN salary_structures ss ON ss.staff_id=s.id AND ss.tenant_id=d.tenant_id
        AND ss.status='APPROVED' AND ss.effective_from<=CURRENT_DATE
        AND (ss.effective_to IS NULL OR ss.effective_to>=CURRENT_DATE)
        AND NOT EXISTS (
          SELECT 1 FROM salary_structures newer
           WHERE newer.tenant_id=ss.tenant_id AND newer.staff_id=ss.staff_id
             AND newer.status='APPROVED' AND newer.effective_from<=CURRENT_DATE
             AND (newer.effective_to IS NULL OR newer.effective_to>=CURRENT_DATE)
             AND newer.effective_from>ss.effective_from
        )
      WHERE d.tenant_id=?
      GROUP BY d.id ORDER BY headcount DESC
    `, [req.tenantId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/hr/reports/performance', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const period = String(req.query.month || new Date().toISOString().slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }
    const start = `${period}-01`;
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const endDate = end.toISOString().slice(0, 10);
    const [rows] = await pool.query(
      `SELECT s.id AS staff_id,s.name,s.role,s.monthly_target,s.monthly_target_type,s.monthly_bonus,
              COALESCE(p.revenue,0) revenue,COALESCE(p.orders_count,0) orders_count,
              COALESCE(c.commission,0) commission,
              COALESCE(l.leads_count,0) leads_count,COALESCE(l.converted_count,0) converted_count
         FROM staff s
         LEFT JOIN (
           SELECT staff_id,SUM(amount_egp) revenue,COUNT(*) orders_count
             FROM payments
            WHERE tenant_id=? AND status='paid' AND deleted_at IS NULL
              AND date>=? AND date<?
            GROUP BY staff_id
         ) p ON p.staff_id=s.id
         LEFT JOIN (
           SELECT staff_id,SUM(commission_amount) commission
             FROM crm_commissions
            WHERE tenant_id=? AND year=? AND month=? AND status<>'CANCELLED'
            GROUP BY staff_id
         ) c ON c.staff_id=s.id
         LEFT JOIN (
           SELECT assigned_sales_id staff_id,COUNT(*) leads_count,
                  SUM(status IN ('converted','won')) converted_count
             FROM leads
            WHERE tenant_id=? AND deleted_at IS NULL AND created_at>=? AND created_at<?
            GROUP BY assigned_sales_id
         ) l ON l.staff_id=s.id
        WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL
        ORDER BY revenue DESC,converted_count DESC,s.name`,
      [req.tenantId, start, endDate, req.tenantId, Number(period.slice(0, 4)), Number(period.slice(5, 7)),
        req.tenantId, start, endDate, req.tenantId]
    );
    res.json(rows.map(row => {
      const revenue = Number(row.revenue || 0);
      const converted = Number(row.converted_count || 0);
      const targetType = row.monthly_target_type || 'egp';
      const target = Number(row.monthly_target || 0);
      const progress = targetType === 'clients' ? converted : revenue;
      const targetPct = target > 0 ? Math.min(100, Math.round(progress / target * 100)) : 0;
      return {
        ...row,
        revenue,
        commission: Number(row.commission || 0),
        orders_count: Number(row.orders_count || 0),
        leads_count: Number(row.leads_count || 0),
        converted_count: converted,
        conversion_rate: Number(row.leads_count) > 0 ? Math.round(converted / Number(row.leads_count) * 100) : 0,
        target_pct: targetPct,
        target_hit: target > 0 && progress >= target,
        bonus: target > 0 && progress >= target ? Number(row.monthly_bonus || 0) : 0,
      };
    }));
  } catch (e) {
    logger.error('[hr/performance]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
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
    if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 2020 || y > 2100) {
      return res.status(400).json({ error: 'Invalid month or year' });
    }
    const periodStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const periodEndDate = new Date(`${periodStart}T00:00:00Z`);
    periodEndDate.setUTCMonth(periodEndDate.getUTCMonth() + 1);
    const periodEnd = periodEndDate.toISOString().slice(0, 10);

    const [[profile]] = await pool.query(`
      SELECT s.id, s.name, s.role, s.image, s.joined_at AS hire_date,
        s.employment_type, d.name AS department_name,
        ss.base_salary, ss.housing_allowance, ss.transport_allowance, s.commission_rate
      FROM staff s
      LEFT JOIN hr_departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id
      LEFT JOIN salary_structures ss ON ss.staff_id=s.id AND ss.tenant_id=s.tenant_id
        AND ss.status='APPROVED' AND ss.effective_from<=CURRENT_DATE
        AND (ss.effective_to IS NULL OR ss.effective_to>=CURRENT_DATE)
        AND NOT EXISTS (
          SELECT 1 FROM salary_structures newer
           WHERE newer.tenant_id=ss.tenant_id AND newer.staff_id=ss.staff_id
             AND newer.status='APPROVED' AND newer.effective_from<=CURRENT_DATE
             AND (newer.effective_to IS NULL OR newer.effective_to>=CURRENT_DATE)
             AND newer.effective_from>ss.effective_from
        )
      WHERE s.tenant_id=? AND s.id=? AND s.deleted_at IS NULL
    `, [req.tenantId, staff.id]);

    const [leaves] = await pool.query(`
      SELECT l.id,l.type,l.start_date,l.end_date,l.total_days,l.status,l.reason,l.created_at,
             a.name AS approved_by_name
      FROM leaves l
      LEFT JOIN staff a ON a.id=l.approved_by AND a.tenant_id=l.tenant_id
      WHERE l.tenant_id=? AND l.staff_id=? ORDER BY l.created_at DESC LIMIT 20
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

    const policy = await getEffectiveHrPolicy(pool, req.tenantId);
    const annualEntitlement = Number(policy.annual_leave_days);
    const [[annualUsage]] = await pool.query(
      `SELECT COALESCE(SUM(total_days),0) AS used_days
         FROM leaves
        WHERE tenant_id=? AND staff_id=? AND type='ANNUAL' AND status='APPROVED'
          AND YEAR(start_date)=?`,
      [req.tenantId, staff.id, y]
    );
    const usedDays = Number(annualUsage?.used_days || 0);
    const attendanceSummary = attendance.reduce((summary, day) => {
      if (['PRESENT', 'LATE', 'REMOTE'].includes(day.status)) summary.present_days += 1;
      if (day.status === 'ABSENT') summary.absent_days += 1;
      if (day.status === 'LATE') summary.late_days += 1;
      summary.total_late_minutes += Number(day.late_minutes || 0);
      return summary;
    }, { present_days: 0, absent_days: 0, late_days: 0, total_late_minutes: 0 });
    const [[commission]] = await pool.query(
      `SELECT COALESCE(SUM(commission_amount),0) total,COUNT(*) count
         FROM crm_commissions
        WHERE tenant_id=? AND staff_id=? AND month=? AND year=? AND status<>'CANCELLED'`,
      [req.tenantId, staff.id, m, y]
    );
    const [[kpi]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM leads
           WHERE tenant_id=? AND deleted_at IS NULL AND assigned_sales_id=?
             AND created_at>=? AND created_at<?) leads_assigned,
         (SELECT COUNT(*) FROM leads
           WHERE tenant_id=? AND deleted_at IS NULL AND assigned_sales_id=?
             AND status IN ('converted','won') AND created_at>=? AND created_at<?) leads_converted,
         (SELECT COALESCE(SUM(amount_egp),0) FROM payments
           WHERE tenant_id=? AND deleted_at IS NULL AND status='paid' AND staff_id=?
             AND date>=? AND date<?) revenue_generated`,
      [req.tenantId, staff.id, periodStart, periodEnd,
        req.tenantId, staff.id, periodStart, periodEnd,
        req.tenantId, staff.id, periodStart, periodEnd]
    );
    const salary = profile?.base_salary == null ? null : {
      base_salary: profile.base_salary,
      housing_allowance: profile.housing_allowance,
      transport_allowance: profile.transport_allowance,
    };
    res.json({
      profile, leaves, attendanceLogs: attendance, payslips,
      staff: profile,
      salary,
      commission: { thisMonth: commission || null },
      attendance: attendanceSummary,
      leaveBalance: {
        annualEntitlement,
        usedDays,
        remaining: Math.max(0, annualEntitlement - usedDays),
      },
      leaveHistory: leaves,
      kpi: {
        leads_assigned: Number(kpi?.leads_assigned || 0),
        leads_converted: Number(kpi?.leads_converted || 0),
        revenue_generated: Number(kpi?.revenue_generated || 0),
      },
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v15 — Salary Advance Requests
// ══════════════════════════════════════════════════════════════

// List advances (admin: all, staff: own)
module.exports = router;
