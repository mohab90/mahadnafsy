'use strict';
const { Router } = require('express');
const router = Router();
const { logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');


// GET /api/admin/hr/employees — list all employees with HR info
router.get('/api/admin/hr/employees', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [employees] = await pool.query(`
      SELECT s.id, s.name, s.email, s.phone, s.role, s.image, s.is_active,
             s.department_id, s.manager_id, s.employment_type, s.hire_date,
             s.commission_rate, s.joined_at,
             d.name AS department_name,
             m.name AS manager_name
      FROM staff s
      LEFT JOIN hr_departments d ON d.id = s.department_id
      LEFT JOIN staff m ON m.id = s.manager_id
      ORDER BY s.name ASC
    `);
    res.json(employees);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/hr/employees/:id — full employee profile
router.get('/api/admin/hr/employees/:id', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { id } = req.params;
    // Basic staff info
    const [[staff]] = await pool.query(`
      SELECT s.*, d.name AS department_name, m.name AS manager_name
      FROM staff s
      LEFT JOIN hr_departments d ON d.id = s.department_id
      LEFT JOIN staff m ON m.id = s.manager_id
      WHERE s.id = ? LIMIT 1
    `, [id]);
    if (!staff) return res.status(404).json({ error: 'Employee not found' });

    // Current salary structure
    const [[salary]] = await pool.query(`
      SELECT id, staff_id, base_salary, housing_allowance, transport_allowance,
             other_allowances_json, currency, effective_from, effective_to, created_by, created_at
      FROM salary_structures
      WHERE staff_id = ? AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
      ORDER BY effective_from DESC LIMIT 1
    `, [id]);

    // Commission this month from crm_commissions
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();
    const [[commThisMonth]] = await pool.query(`
      SELECT COALESCE(SUM(commission_amount),0) AS total, COUNT(*) AS count
      FROM crm_commissions
      WHERE staff_id = ? AND month = ? AND year = ? AND status != 'CANCELLED'
    `, [id, curMonth, curYear]);

    // Fallback: calculate commission from payments if crm_commissions is empty
    // Uses commission_rules percentage when staff commission_rate=0
    let commissionFallback = null;
    if (!commThisMonth || commThisMonth.count === 0) {
      // Get effective commission rate: prefer commission_rules, fallback to staff.commission_rate
      const [[activeRule]] = await pool.query(`
        SELECT cr.percentage_value
        FROM commission_rules cr
        WHERE cr.is_active = 1
          AND (cr.staff_id = ? OR (cr.staff_id IS NULL AND JSON_CONTAINS(cr.apply_to_roles, JSON_QUOTE(
            (SELECT role FROM staff WHERE id = ? LIMIT 1)
          ))))
          AND cr.calc_type = 'PERCENTAGE'
          AND (cr.effective_to IS NULL OR cr.effective_to >= CURDATE())
          AND cr.effective_from <= CURDATE()
        ORDER BY cr.staff_id DESC, cr.priority ASC
        LIMIT 1
      `, [id, id]).catch(() => [[null]]);
      const effectiveRate = activeRule?.percentage_value || null;

      const [[fb]] = await pool.query(`
        SELECT COALESCE(SUM(p.amount * COALESCE(?, COALESCE(s.commission_rate,0)) / 100), 0) AS total,
               COUNT(*) AS count
        FROM payments p
        JOIN staff s ON s.id = p.staff_id
        WHERE p.staff_id = ?
          AND p.status = 'paid'
          AND MONTH(p.date) = ? AND YEAR(p.date) = ?
      `, [effectiveRate, id, curMonth, curYear]);
      commissionFallback = fb ? { ...fb, usedRate: effectiveRate } : fb;
    }

    // All commission history (last 6 months) from payments
    // Uses effective commission_rate from staff or commission_rules
    const [[ruleForHistory]] = await pool.query(`
      SELECT percentage_value FROM commission_rules
      WHERE is_active=1 AND calc_type='PERCENTAGE'
        AND (staff_id=? OR staff_id IS NULL)
        AND (effective_to IS NULL OR effective_to >= CURDATE())
      ORDER BY staff_id DESC LIMIT 1
    `, [id]).catch(() => [[null]]);
    const histRate = ruleForHistory?.percentage_value || null;
    const [commHistory] = await pool.query(`
      SELECT MONTH(p.date) AS month, YEAR(p.date) AS year,
             SUM(p.amount) AS total_sales,
             SUM(p.amount * COALESCE(?, COALESCE(s.commission_rate,0)) / 100) AS commission,
             COUNT(*) AS sales_count
      FROM payments p
      JOIN staff s ON s.id = p.staff_id
      WHERE p.staff_id = ? AND p.status = 'paid' AND p.date >= DATE_SUB(CURRENT_DATE, INTERVAL 6 MONTH)
      GROUP BY YEAR(p.date), MONTH(p.date)
      ORDER BY YEAR(p.date) DESC, MONTH(p.date) DESC
    `, [histRate, id]);

    // Attendance this month
    const [[attendance]] = await pool.query(`
      SELECT
        COUNT(CASE WHEN status IN ('PRESENT','LATE','REMOTE') THEN 1 END) AS present_days,
        COUNT(CASE WHEN status = 'ABSENT' THEN 1 END) AS absent_days,
        COUNT(CASE WHEN status = 'LATE' THEN 1 END) AS late_days,
        COUNT(CASE WHEN status = 'HALF_DAY' THEN 1 END) AS half_days,
        COALESCE(SUM(late_minutes),0) AS total_late_minutes
      FROM attendance_logs
      WHERE staff_id = ? AND MONTH(date) = ? AND YEAR(date) = ?
    `, [id, curMonth, curYear]);

    // Leave balance (annual leaves taken this year)
    const [[leaveUsed]] = await pool.query(`
      SELECT COALESCE(SUM(total_days), 0) AS used_days
      FROM leaves
      WHERE staff_id = ? AND type = 'ANNUAL' AND status = 'APPROVED'
        AND YEAR(start_date) = ?
    `, [id, curYear]);

    // All leaves (last 20)
    const [leaveHistory] = await pool.query(`
      SELECT l.*, a.name AS approved_by_name
      FROM leaves l
      LEFT JOIN staff a ON a.id = l.approved_by
      WHERE l.staff_id = ?
      ORDER BY l.created_at DESC LIMIT 20
    `, [id]);

    // Pending leaves (for HR approval view)
    const [pendingLeaves] = await pool.query(`
      SELECT l.*, s.name AS staff_name, s.role, s.image
      FROM leaves l
      JOIN staff s ON s.id = l.staff_id
      WHERE l.status = 'PENDING'
      ORDER BY l.created_at ASC
    `);

    // KPI this month: leads handled, converted, revenue
    const [[kpi]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM leads WHERE assigned_sales_id = ? AND MONTH(created_at) = ? AND YEAR(created_at) = ?) AS leads_assigned,
        (SELECT COUNT(*) FROM leads WHERE assigned_sales_id = ? AND status IN ('closed','converted') AND MONTH(updated_at) = ? AND YEAR(updated_at) = ?) AS leads_converted,
        (SELECT COALESCE(SUM(amount),0) FROM payments WHERE staff_id = ? AND status='paid' AND MONTH(date) = ? AND YEAR(date) = ?) AS revenue_generated
    `, [id, curMonth, curYear, id, curMonth, curYear, id, curMonth, curYear]);

    res.json({
      staff,
      salary: salary || null,
      commission: {
        thisMonth: commThisMonth?.count > 0 ? commThisMonth : commissionFallback,
        history: commHistory,
      },
      attendance: attendance || {},
      leaveBalance: {
        annualEntitlement: 21, // standard
        usedDays: parseFloat(leaveUsed?.used_days || 0),
        remaining: 21 - parseFloat(leaveUsed?.used_days || 0),
      },
      leaveHistory,
      pendingLeaves,
      kpi: kpi || {},
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/hr/employees/:id — update employee HR info
router.put('/api/admin/hr/employees/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['department_id','manager_id','employment_type','hire_date','birth_date','bank_name','is_active'];
    const updates = {};
    for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k] || null; }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
    const setClauses = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
    const vals = [...Object.values(updates), id];
    await pool.query(`UPDATE staff SET ${setClauses} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/hr/departments
router.get('/api/admin/hr/departments', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, branch, manager_id, description, is_active, created_at FROM hr_departments WHERE is_active = 1 ORDER BY name'
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/hr/leaves — all leaves for HR/manager (with filters)
module.exports = router;
