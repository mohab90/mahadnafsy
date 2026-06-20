'use strict';
const logger = require('../lib/logger');
const { Router } = require('express');
const router = Router();

const { pool, getStaffIdByEmail } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');
const { createNotification } = require('../lib/notification');
const { uuidv4 } = require('../lib/id');
const { postJournalEntry, toEgp, getFxToEgp, logFinancialAudit } = require('../lib/finance');

// ══════════════════════════════════════════════════════════════
// HR SYSTEM ENDPOINTS
// ══════════════════════════════════════════════════════════════

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
router.get('/api/admin/hr/leaves', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { status, staff_id, month, year } = req.query;
    let sql = `
      SELECT l.*, s.name AS staff_name, s.role, s.image,
             a.name AS approved_by_name
      FROM leaves l
      JOIN staff s ON s.id = l.staff_id
      LEFT JOIN staff a ON a.id = l.approved_by
      WHERE 1=1
    `;
    const params = [];
    if (status)   { sql += ' AND l.status = ?';  params.push(status); }
    if (staff_id) { sql += ' AND l.staff_id = ?'; params.push(staff_id); }
    if (month)    { sql += ' AND MONTH(l.start_date) = ?'; params.push(month); }
    if (year)     { sql += ' AND YEAR(l.start_date) = ?';  params.push(year); }
    sql += ' ORDER BY l.created_at DESC LIMIT 200';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/hr/leaves — submit leave or permission request
router.post('/api/admin/hr/leaves', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staff_id, type, start_date, end_date, reason } = req.body;
    if (!staff_id || !type || !start_date || !end_date) {
      return res.status(400).json({ error: 'staff_id, type, start_date, end_date are required' });
    }
    const VALID_TYPES = ['ANNUAL','SICK','UNPAID','MATERNITY','EMERGENCY','PERMISSION','OTHER'];
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid leave type' });

    // Calculate days
    const d1 = new Date(start_date);
    const d2 = new Date(end_date);
    if (isNaN(d1) || isNaN(d2) || d2 < d1) return res.status(400).json({ error: 'Invalid dates' });
    const totalDays = type === 'PERMISSION' ? 0.5 : Math.ceil((d2 - d1) / 86400000) + 1;

    const id = uuidv4();
    await pool.query(
      `INSERT INTO leaves (id, staff_id, type, start_date, end_date, total_days, reason, status)
       VALUES (?,?,?,?,?,?,?,'PENDING')`,
      [id, staff_id, type, start_date, end_date, totalDays, reason || null]
    );

    // Notify admin
    await createNotification('info', 'طلب إجازة جديد',
      `موظف طلب ${type === 'PERMISSION' ? 'إذن' : 'إجازة'} من ${start_date} إلى ${end_date}`,
      { leave_id: id, staff_id }
    );

    res.json({ ok: true, id, total_days: totalDays });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/hr/leaves/:id/status — approve or reject leave
router.put('/api/admin/hr/leaves/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, admin_note } = req.body;
    if (!['APPROVED','REJECTED','CANCELLED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const approver = req.staffRecord?.id || req.user?.uid || null;
    await pool.query(
      `UPDATE leaves SET status=?, approved_by=?, approved_at=NOW(), admin_note=? WHERE id=?`,
      [status, approver, admin_note || null, id]
    );

    // If approved, sync attendance record
    if (status === 'APPROVED') {
      const [[leave]] = await pool.query(
        `SELECT id, staff_id, type, start_date, end_date, total_days, reason, status,
                approved_by, approved_at, admin_note, created_at
         FROM leaves WHERE id = ?`, [id]
      );
      if (leave) {
        const d1 = new Date(leave.start_date);
        const d2 = new Date(leave.end_date);
        for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().slice(0, 10);
          await pool.query(
            `INSERT INTO attendance_logs (id, staff_id, date, status, notes, source)
             VALUES (UUID(), ?, ?, 'LEAVE', ?, 'MANUAL_ENTRY')
             ON DUPLICATE KEY UPDATE status='LEAVE', notes=VALUES(notes)`,
            [leave.staff_id, dateStr, `إجازة معتمدة: ${leave.type}`]
          ).catch(() => {});
        }
      }
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/hr/salary — save/update salary structure
router.post('/api/admin/hr/salary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { staff_id, base_salary, housing_allowance, transport_allowance, food_allowance, other_fixed,
            deduction_social_insurance, deduction_tax, other_allowances_json, currency, effective_from } = req.body;
    if (!staff_id || base_salary === undefined) return res.status(400).json({ error: 'staff_id and base_salary required' });
    // Close previous open salary
    await pool.query(
      `UPDATE salary_structures SET effective_to = DATE_SUB(?, INTERVAL 1 DAY) WHERE staff_id = ? AND effective_to IS NULL`,
      [effective_from || new Date().toISOString().slice(0,10), staff_id]
    );
    const id = uuidv4();
    const createdBy = req.staffRecord?.id || null;
    await pool.query(
      `INSERT INTO salary_structures (id, staff_id, base_salary, housing_allowance, transport_allowance, food_allowance, other_fixed, deduction_social_insurance, deduction_tax, other_allowances_json, currency, effective_from, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, staff_id, base_salary, housing_allowance||0, transport_allowance||0,
       food_allowance||0, other_fixed||0, deduction_social_insurance||0, deduction_tax||0,
       other_allowances_json ? JSON.stringify(other_allowances_json) : null,
       currency||'EGP', effective_from || new Date().toISOString().slice(0,10), createdBy]
    );
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/hr/attendance/:staffId — attendance logs for a staff member
router.get('/api/admin/hr/attendance/:staffId', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();
    const [rows] = await pool.query(
      `SELECT id, staff_id, branch, date, check_in, check_out, total_hours, late_minutes,
              status, notes, source, import_batch_id, created_at, updated_at
       FROM attendance_logs WHERE staff_id = ? AND MONTH(date) = ? AND YEAR(date) = ? ORDER BY date`,
      [staffId, m, y]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/hr/attendance — manual attendance entry
router.post('/api/admin/hr/attendance', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { staff_id, date, check_in, check_out, status, notes } = req.body;
    if (!staff_id || !date) return res.status(400).json({ error: 'staff_id and date required' });
    const VALID_STATUSES = ['PRESENT','ABSENT','LATE','HALF_DAY','LEAVE','HOLIDAY','REMOTE'];
    const safeStatus = VALID_STATUSES.includes(status) ? status : 'PRESENT';
    // Calculate late_minutes if check_in provided and after 09:15 (grace 15min)
    let lateMin = 0;
    if (check_in) {
      const [h,m2] = check_in.split(':').map(Number);
      const minutesIn = h * 60 + m2;
      const graceEnd = 9 * 60 + 15; // 09:15
      if (minutesIn > graceEnd) lateMin = minutesIn - graceEnd;
    }
    let totalHours = null;
    if (check_in && check_out) {
      const [hi,mi] = check_in.split(':').map(Number);
      const [ho,mo] = check_out.split(':').map(Number);
      totalHours = Math.round(((ho*60+mo) - (hi*60+mi)) / 60 * 100) / 100;
    }
    await pool.query(
      `INSERT INTO attendance_logs (id, staff_id, date, check_in, check_out, total_hours, late_minutes, status, notes, source)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL_ENTRY')
       ON DUPLICATE KEY UPDATE check_in=VALUES(check_in), check_out=VALUES(check_out),
         total_hours=VALUES(total_hours), late_minutes=VALUES(late_minutes),
         status=VALUES(status), notes=VALUES(notes)`,
      [staff_id, date, check_in||null, check_out||null, totalHours, lateMin, safeStatus, notes||null]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/hr/kpi/:staffId — KPI summary for a staff member
router.get('/api/admin/hr/kpi/:staffId', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();

    // Auto-calculate actuals from CRM
    const [[actuals]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM leads WHERE assigned_sales_id = ? AND MONTH(created_at)=? AND YEAR(created_at)=?) AS leads_assigned,
        (SELECT COUNT(*) FROM leads WHERE assigned_sales_id = ? AND status IN ('closed','converted') AND MONTH(updated_at)=? AND YEAR(updated_at)=?) AS leads_converted,
        (SELECT COUNT(*) FROM leads WHERE assigned_sales_id = ? AND status = 'contacted' AND MONTH(updated_at)=? AND YEAR(updated_at)=?) AS leads_contacted,
        (SELECT COALESCE(SUM(amount),0) FROM payments WHERE staff_id=? AND status='paid' AND MONTH(date)=? AND YEAR(date)=?) AS revenue_generated,
        (SELECT COUNT(*) FROM payments WHERE staff_id=? AND status='paid' AND MONTH(date)=? AND YEAR(date)=?) AS sales_count,
        (SELECT COUNT(*) FROM subscribers WHERE assigned_sales_id=? AND MONTH(created_at)=? AND YEAR(created_at)=?) AS subscribers_enrolled
    `, [staffId,m,y, staffId,m,y, staffId,m,y, staffId,m,y, staffId,m,y, staffId,m,y]);

    // KPI targets
    const [targets] = await pool.query(
      `SELECT id, staff_id, metric, target_value, period, from_date, to_date, notes, set_by, created_at
       FROM kpi_targets WHERE staff_id=? AND from_date <= ? AND to_date >= ?`,
      [staffId, `${y}-${String(m).padStart(2,'0')}-01`, `${y}-${String(m).padStart(2,'0')}-01`]
    );

    // Historical (last 6 months)
    const [history] = await pool.query(`
      SELECT MONTH(date) AS month, YEAR(date) AS year,
             COUNT(*) AS sales_count, SUM(amount) AS revenue
      FROM payments
      WHERE staff_id=? AND status='paid' AND date >= DATE_SUB(CURRENT_DATE, INTERVAL 6 MONTH)
      GROUP BY YEAR(date), MONTH(date) ORDER BY YEAR(date) DESC, MONTH(date) DESC
    `, [staffId]);

    res.json({ actuals, targets, history });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// HR — PAYROLL
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/hr/payroll — list payroll runs
router.get('/api/admin/hr/payroll', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [runs] = await pool.query(`
      SELECT pr.*,
        s.name AS calculated_by_name,
        s2.name AS approved_by_name
      FROM payroll_runs pr
      LEFT JOIN staff s  ON s.id  = pr.calculated_by
      LEFT JOIN staff s2 ON s2.id = pr.approved_by
      ORDER BY pr.year DESC, pr.month DESC
      LIMIT 24
    `);
    res.json(runs);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/hr/payroll/calculate — calculate payroll for a month
router.post('/api/admin/hr/payroll/calculate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { month, year, notes } = req.body;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();
    const adminId = await getStaffIdByEmail(req.user?.email);

    // Upsert run
    await pool.query(`
      INSERT INTO payroll_runs (month, year, status, notes, calculated_by, calculated_at)
      VALUES (?, ?, 'CALCULATED', ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        status = 'CALCULATED', notes = VALUES(notes),
        calculated_by = VALUES(calculated_by), calculated_at = NOW()
    `, [m, y, notes || null, adminId]);

    const [[run]] = await pool.query(`SELECT id FROM payroll_runs WHERE month=? AND year=?`, [m, y]);
    const runId = run.id;

    // Get all active staff with salary structures
    const [employees] = await pool.query(`
      SELECT s.id AS staff_id, s.name, s.commission_rate,
        ss.base_salary, ss.housing_allowance, ss.transport_allowance,
        ss.food_allowance, ss.other_fixed, ss.deduction_social_insurance, ss.deduction_tax,
        ss.other_allowances_json
      FROM staff s
      LEFT JOIN salary_structures ss ON ss.staff_id = s.id
      WHERE s.is_active = 1
    `);

    // ── Batch-fetch all payroll metrics (avoid N+1 — one query per metric for ALL staff) ──
    const empIds = employees.map(e => e.staff_id);
    let totalAmount = 0;

    // Batch attendance stats
    const [attBatch] = empIds.length ? await pool.query(`
      SELECT staff_id,
        COUNT(CASE WHEN status='ABSENT' THEN 1 END) AS absent_days,
        COALESCE(SUM(late_minutes), 0) AS late_minutes,
        COUNT(CASE WHEN status IN ('PRESENT','LATE','HALF_DAY') THEN 1 END) AS present_days
      FROM attendance_logs
      WHERE staff_id IN (?) AND MONTH(date)=? AND YEAR(date)=?
      GROUP BY staff_id
    `, [empIds, m, y]).catch(() => [[]]) : [[]];
    const attMap = Object.fromEntries(attBatch.map(r => [r.staff_id, r]));

    // Batch commissions — UNIFIED source: crm_commissions rows written at payment time
    // by commission_rules (same numbers sales sees in their dashboard). Only staff with
    // no commission rows this month fall back to flat staff.commission_rate over sales.
    const [ccBatch] = empIds.length ? await pool.query(`
      SELECT staff_id, COALESCE(SUM(commission_amount),0) AS amt, COUNT(*) AS cnt
      FROM crm_commissions
      WHERE staff_id IN (?) AND month=? AND year=? AND status IN ('PENDING','INCLUDED_IN_PAYROLL')
      GROUP BY staff_id
    `, [empIds, m, y]).catch(() => [[]]) : [[]];
    const ccMap = Object.fromEntries(ccBatch.map(r => [r.staff_id, { amt: parseFloat(r.amt) || 0, cnt: parseInt(r.cnt) || 0 }]));

    // Fallback sales sums — grouped per currency and converted to EGP so SAR/USD
    // payments don't get added as if they were EGP.
    const [commBatch] = empIds.length ? await pool.query(`
      SELECT staff_id, currency, COALESCE(SUM(amount),0) AS total_sales
      FROM payments
      WHERE staff_id IN (?) AND status='paid' AND MONTH(date)=? AND YEAR(date)=?
      GROUP BY staff_id, currency
    `, [empIds, m, y]).catch(() => [[]]) : [[]];
    const _fx = await getFxToEgp();
    const commMap = {};
    for (const r of commBatch) {
      const egp = (parseFloat(r.total_sales) || 0) * (_fx[String(r.currency || 'EGP').toUpperCase()] || 1);
      commMap[r.staff_id] = (commMap[r.staff_id] || 0) + egp;
    }

    // Batch advance deductions
    const [advBatch] = empIds.length ? await pool.query(`
      SELECT staff_id, COALESCE(SUM(amount),0) AS advances
      FROM salary_advances
      WHERE staff_id IN (?) AND deduct_month=? AND deduct_year=? AND status='APPROVED'
      GROUP BY staff_id
    `, [empIds, m, y]).catch(() => [[]]) : [[]];
    const advMap = Object.fromEntries(advBatch.map(r => [r.staff_id, parseFloat(r.advances) || 0]));

    // For each employee, calculate net salary (now pure in-memory — no per-employee DB queries for att/comm/adv)
    for (const emp of employees) {
      const baseSalary = parseFloat(emp.base_salary) || 0;
      const housing    = parseFloat(emp.housing_allowance) || 0;
      const transport  = parseFloat(emp.transport_allowance) || 0;
      const food       = parseFloat(emp.food_allowance) || 0;
      const otherFixed = parseFloat(emp.other_fixed) || 0;
      const dedSocial  = parseFloat(emp.deduction_social_insurance) || 0;
      const dedTax     = parseFloat(emp.deduction_tax) || 0;
      const totalAllowances = housing + transport + food + otherFixed;

      // Attendance from batch map
      const attStats = attMap[emp.staff_id] || { absent_days: 0, late_minutes: 0, present_days: 0 };
      const absentDays   = parseInt(attStats.absent_days) || 0;
      const lateMins     = parseInt(attStats.late_minutes) || 0;
      const presentDays  = parseInt(attStats.present_days) || 0;

      const dailyRate   = baseSalary / 26;
      const minuteRate  = baseSalary / (26 * 8 * 60);
      const absenceDeduction = dailyRate * absentDays;
      const lateDeduction    = minuteRate * lateMins;

      // Commission — unified: crm_commissions first, flat-rate fallback (EGP-converted sales)
      const ccRow = ccMap[emp.staff_id];
      const totalSales = commMap[emp.staff_id] || 0;
      let commission, commissionCount, commissionSource;
      if (ccRow && ccRow.amt > 0) {
        commission = ccRow.amt;
        commissionCount = ccRow.cnt;
        commissionSource = 'crm_commissions';
      } else {
        commission = totalSales * ((parseFloat(emp.commission_rate) || 0) / 100);
        commissionCount = null;
        commissionSource = 'flat_rate';
      }

      // Advance deductions from batch map
      const advanceDeduction = advMap[emp.staff_id] || 0;

      // Instructor session/hour earnings this month
      let instructorEarnings = 0;
      try {
        const [[iRates]] = await pool.query(
          `SELECT id, staff_id, consultation_rate_type, consultation_rate_value, lecture_rate_per_hour,
                  training_rate_per_hour, currency, notes, updated_at
           FROM instructor_rates WHERE staff_id=?`, [emp.staff_id]
        );
        if (iRates) {
          if (iRates.consultation_rate_type === 'per_session') {
            const [[cSessions]] = await pool.query(
              `SELECT COUNT(*) AS cnt FROM consultations WHERE assigned_staff_id=? AND status='COMPLETED' AND MONTH(session_date)=? AND YEAR(session_date)=?`,
              [emp.staff_id, m, y]
            ).catch(() => [[{ cnt: 0 }]]);
            instructorEarnings += (cSessions.cnt || 0) * (parseFloat(iRates.consultation_rate_value) || 0);
          }
          const [[lHours]] = await pool.query(
            `SELECT COALESCE(SUM(duration_hours),0) AS hrs FROM lecture_logs WHERE staff_id=? AND MONTH(lecture_date)=? AND YEAR(lecture_date)=?`,
            [emp.staff_id, m, y]
          ).catch(() => [[{ hrs: 0 }]]);
          instructorEarnings += (parseFloat(lHours.hrs) || 0) * (parseFloat(iRates.lecture_rate_per_hour) || 0);
        }
      } catch (_) { /* non-fatal */ }

      // Bonuses this month
      const [[bonusStats]] = await pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN type='bonus'     THEN amount ELSE 0 END), 0) AS total_bonus,
          COALESCE(SUM(CASE WHEN type='deduction' THEN amount ELSE 0 END), 0) AS total_deduction
        FROM employee_bonuses WHERE staff_id=? AND for_month=? AND for_year=?
      `, [emp.staff_id, m, y]).catch(() => [[{ total_bonus: 0, total_deduction: 0 }]]);
      const bonusTotal     = parseFloat(bonusStats.total_bonus)     || 0;
      const deductionTotal = parseFloat(bonusStats.total_deduction) || 0;

      const grossSalary = baseSalary + totalAllowances + commission + instructorEarnings + bonusTotal;
      const totalDeductions = dedSocial + dedTax + absenceDeduction + lateDeduction + advanceDeduction + deductionTotal;
      const netSalary = Math.max(0, grossSalary - totalDeductions);
      totalAmount += netSalary;

      const allowancesJson = JSON.stringify({ housing, transport, food, other: otherFixed });
      // calculation_details makes the payslip reconcile with net_salary (bonus &
      // instructor earnings used to be folded into net invisibly).
      const calcDetails = JSON.stringify({
        instructorEarnings, commissionSource, totalSalesEgp: Math.round(totalSales * 100) / 100,
        bonusTotal, deductionTotal, dedSocial, dedTax,
      });
      await pool.query(`
        INSERT INTO payroll_items
          (payroll_run_id, staff_id, base_salary, allowances_json, total_allowances,
           commission, bonus, late_deductions, absence_deductions, advance_deductions,
           other_deductions, net_salary, attendance_days, absent_days, late_minutes,
           commission_count, calculation_details)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE
          base_salary=VALUES(base_salary), allowances_json=VALUES(allowances_json),
          total_allowances=VALUES(total_allowances), commission=VALUES(commission),
          bonus=VALUES(bonus),
          late_deductions=VALUES(late_deductions), absence_deductions=VALUES(absence_deductions),
          advance_deductions=VALUES(advance_deductions), other_deductions=VALUES(other_deductions),
          net_salary=VALUES(net_salary), attendance_days=VALUES(attendance_days),
          absent_days=VALUES(absent_days), late_minutes=VALUES(late_minutes),
          commission_count=VALUES(commission_count), calculation_details=VALUES(calculation_details)
      `, [runId, emp.staff_id, baseSalary, allowancesJson, totalAllowances,
          commission, bonusTotal, lateDeduction, absenceDeduction, advanceDeduction,
          dedSocial + dedTax + deductionTotal, netSalary, presentDays, absentDays, lateMins,
          commissionCount, calcDetails]);
    }

    // Link consumed commissions to this run so they can't double-count next month
    // and get settled (→ PAID) when the run is paid.
    if (empIds.length) {
      await pool.query(
        `UPDATE crm_commissions SET status='INCLUDED_IN_PAYROLL', payroll_run_id=?
         WHERE staff_id IN (?) AND month=? AND year=? AND status='PENDING'`,
        [runId, empIds, m, y]
      ).catch(() => {});
    }

    // Update totals
    await pool.query(`
      UPDATE payroll_runs SET total_amount=?, employee_count=? WHERE id=?
    `, [totalAmount, employees.length, runId]);

    // Return run with items
    const [[updatedRun]] = await pool.query(
      `SELECT id, month, year, status, total_amount, employee_count, currency, notes,
              calculated_by, approved_by, paid_by, calculated_at, approved_at, paid_at, created_at
       FROM payroll_runs WHERE id=?`, [runId]
    );
    const [items] = await pool.query(`
      SELECT pi.*, s.name AS staff_name, s.name, s.role, s.image,
             pi.total_allowances AS allowances_total,
             pi.late_deductions AS late_deduction,
             pi.absence_deductions AS absence_deduction,
             pi.advance_deductions AS advance_deduction,
             pi.other_deductions AS other_deduction,
             pi.bonus AS bonus_amount,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pi.calculation_details, '$.instructorEarnings')), 0) AS instructor_earnings
      FROM payroll_items pi JOIN staff s ON s.id = pi.staff_id
      WHERE pi.payroll_run_id=?
      ORDER BY s.name
    `, [runId]);

    res.json({ run: updatedRun, items });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/hr/payroll/:runId — get payroll run with items
router.get('/api/admin/hr/payroll/:runId', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { runId } = req.params;
    const [[run]] = await pool.query(
      `SELECT id, month, year, status, total_amount, employee_count, currency, notes,
              calculated_by, approved_by, paid_by, calculated_at, approved_at, paid_at, created_at
       FROM payroll_runs WHERE id=?`, [runId]
    );
    if (!run) return res.status(404).json({ error: 'Not found' });
    const [items] = await pool.query(`
      SELECT pi.*, s.name AS staff_name, s.name, s.role, s.image, d.name AS department_name,
             pi.total_allowances AS allowances_total,
             pi.late_deductions AS late_deduction,
             pi.absence_deductions AS absence_deduction,
             pi.advance_deductions AS advance_deduction,
             pi.other_deductions AS other_deduction,
             0 AS bonus_amount,
             0 AS instructor_earnings
      FROM payroll_items pi
      JOIN staff s ON s.id = pi.staff_id
      LEFT JOIN hr_departments d ON d.id = s.department_id
      WHERE pi.payroll_run_id=?
      ORDER BY s.name
    `, [runId]);
    res.json({ run, items });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/hr/payroll/:runId/status — approve/pay/cancel run
router.put('/api/admin/hr/payroll/:runId/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { runId } = req.params;
    const { status } = req.body;
    const allowed = ['APPROVED','PAID','CANCELLED'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const [[prevRun]] = await pool.query(
      'SELECT id, month, year, status, total_amount, currency FROM payroll_runs WHERE id=? LIMIT 1', [runId]
    );
    if (!prevRun) return res.status(404).json({ error: 'Not found' });
    // Enforce the approval workflow: DRAFT/CALCULATED → APPROVED → PAID.
    // A run can never be paid without being approved first (Top20 #15).
    const transitions = {
      APPROVED:  ['DRAFT', 'CALCULATED'],
      PAID:      ['APPROVED'],
      CANCELLED: ['DRAFT', 'CALCULATED', 'APPROVED'],
    };
    if (!transitions[status].includes(prevRun.status)) {
      return res.status(409).json({ error: `انتقال غير مسموح: ${prevRun.status} → ${status}. لا يمكن صرف الرواتب قبل اعتمادها.` });
    }
    const colMap = { APPROVED: 'approved_by', PAID: 'paid_by', CANCELLED: null };
    const timeMap = { APPROVED: 'approved_at', PAID: 'paid_at', CANCELLED: null };
    let sql = `UPDATE payroll_runs SET status=?`;
    const params = [status];
    if (colMap[status]) { sql += `, ${colMap[status]}=?, ${timeMap[status]}=NOW()`; params.push(req.user.id); }
    sql += ` WHERE id=?`; params.push(runId);
    await pool.query(sql, params);

    // First transition to PAID: post salaries to the journal (5100/1100, EGP)
    // and settle the commissions consumed by this run.
    if (status === 'PAID' && prevRun.status !== 'PAID') {
      const totalEgp = await toEgp(Number(prevRun.total_amount) || 0, prevRun.currency);
      if (totalEgp > 0) {
        postJournalEntry('payroll', runId, new Date().toISOString().slice(0, 10),
          `رواتب شهر ${prevRun.month}/${prevRun.year} (= ${totalEgp} EGP)`,
          [
            { account_code: '5100', account_name: 'رواتب موظفين', debit: totalEgp, credit: 0 },
            { account_code: '1100', account_name: 'نقدية وبنوك',  debit: 0,        credit: totalEgp },
          ],
          req.user?.email || 'system'
        ).catch(() => {});
      }
      pool.query(
        "UPDATE crm_commissions SET status='PAID' WHERE payroll_run_id=? AND status='INCLUDED_IN_PAYROLL'",
        [runId]
      ).catch(() => {});
    }
    await logFinancialAudit({
      entityType: 'payroll', entityId: runId, action: status.toLowerCase(),
      oldData: { status: prevRun.status }, newData: { status },
      amount: Number(prevRun.total_amount) || null,
      actor: req.user?.email || req.user?.name || 'admin',
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/hr/payroll/items/:itemId — override payroll item
router.put('/api/admin/hr/payroll/items/:itemId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { bonus, bonus_note, other_deductions, deductions_note } = req.body;
    // Recalculate net from stored values
    const [[item]] = await pool.query(
      `SELECT id, payroll_run_id, staff_id, base_salary, allowances_json, total_allowances,
              commission, bonus, bonus_note, late_deductions, absence_deductions, advance_deductions,
              other_deductions, deductions_note, net_salary, attendance_days, absent_days,
              late_minutes, commission_count, calculation_details, is_manual_override, override_by, created_at
       FROM payroll_items WHERE id=?`, [itemId]
    );
    if (!item) return res.status(404).json({ error: 'Not found' });
    const b = parseFloat(bonus) || 0;
    const od = parseFloat(other_deductions) ?? parseFloat(item.other_deductions);
    // Include instructor earnings stored at calculation time — otherwise a manual
    // override silently drops them from the net.
    const calcDet = (() => { try { return typeof item.calculation_details === 'string' ? JSON.parse(item.calculation_details) : (item.calculation_details || {}); } catch { return {}; } })();
    const instrEarn = parseFloat(calcDet.instructorEarnings) || 0;
    const net = Math.max(0,
      parseFloat(item.base_salary) + parseFloat(item.total_allowances) +
      parseFloat(item.commission) + instrEarn + b -
      parseFloat(item.late_deductions) - parseFloat(item.absence_deductions) -
      parseFloat(item.advance_deductions) - od
    );
    await pool.query(`
      UPDATE payroll_items SET bonus=?, bonus_note=?, other_deductions=?, deductions_note=?,
        net_salary=?, is_manual_override=1, override_by=? WHERE id=?
    `, [b, bonus_note || null, od, deductions_note || null, net, req.user.id, itemId]);
    // Recalculate run total
    const [[{ total }]] = await pool.query(`SELECT SUM(net_salary) AS total FROM payroll_items WHERE payroll_run_id=?`, [item.payroll_run_id]);
    await pool.query(`UPDATE payroll_runs SET total_amount=? WHERE id=?`, [total, item.payroll_run_id]);
    res.json({ ok: true, net_salary: net });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// HR — ATTENDANCE IMPORT (CSV/text)
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/admin/hr/attendance/import — import attendance from CSV text
// Expects body: { csv: "...", month, year, filename }
// CSV format: employee_id OR name, date, check_in, check_out
router.post('/api/admin/hr/attendance/import', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { csv: csvText, month, year, filename } = req.body;
    if (!csvText) return res.status(400).json({ error: 'No CSV data' });

    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();

    // Create import batch
    const batchId = require('crypto').randomUUID();
    await pool.query(`
      INSERT INTO attendance_import_batches (id, filename, month, year, imported_by, status)
      VALUES (?, ?, ?, ?, ?, 'PROCESSING')
    `, [batchId, filename || 'import.csv', m, y, req.user.id]).catch(() => {});

    // Parse CSV
    const lines = csvText.split('\n').map(l => l.trim()).filter(l => l);
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));

    const idxStaff    = headers.findIndex(h => h.includes('id') || h.includes('name') || h.includes('موظف') || h.includes('employee'));
    const idxDate     = headers.findIndex(h => h.includes('date') || h.includes('تاريخ'));
    const idxCheckIn  = headers.findIndex(h => h.includes('in') || h.includes('دخول') || h.includes('check_in'));
    const idxCheckOut = headers.findIndex(h => h.includes('out') || h.includes('خروج') || h.includes('check_out'));

    if (idxStaff < 0 || idxDate < 0) {
      return res.status(400).json({ error: 'CSV must have employee and date columns', headers });
    }

    // Get all staff for name matching
    const [allStaff] = await pool.query(`SELECT id, name FROM staff WHERE is_active=1`);
    const staffByName = {};
    const staffById   = {};
    allStaff.forEach(s => {
      staffByName[s.name.toLowerCase().trim()] = s.id;
      staffById[s.id] = s.id;
    });

    let imported = 0, skipped = 0, errors = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
      if (cols.length < 2) continue;

      const staffRaw = cols[idxStaff] || '';
      const dateRaw  = cols[idxDate]  || '';

      // Resolve staff id
      let staffId = staffById[staffRaw] || staffByName[staffRaw.toLowerCase().trim()];
      if (!staffId) {
        // Try partial name match
        const partial = Object.keys(staffByName).find(n => n.includes(staffRaw.toLowerCase().trim()) || staffRaw.toLowerCase().includes(n));
        if (partial) staffId = staffByName[partial];
      }
      if (!staffId) { skipped++; errors.push(`Row ${i}: staff "${staffRaw}" not found`); continue; }

      // Parse date — try DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY
      let dateObj;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
        dateObj = new Date(dateRaw);
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateRaw)) {
        const [d, mon, yr] = dateRaw.split('/');
        dateObj = new Date(`${yr}-${String(mon).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
      } else { skipped++; errors.push(`Row ${i}: invalid date "${dateRaw}"`); continue; }

      const dateStr = dateObj.toISOString().split('T')[0];
      const checkIn  = idxCheckIn  >= 0 ? (cols[idxCheckIn]  || null) : null;
      const checkOut = idxCheckOut >= 0 ? (cols[idxCheckOut] || null) : null;

      // Calculate late_minutes and total_hours
      let lateMins = 0, totalHours = null;
      if (checkIn) {
        const [h, min] = checkIn.split(':').map(Number);
        const expectedStart = 9 * 60; // 9:00 AM
        const actualStart   = h * 60 + (min || 0);
        if (actualStart > expectedStart) lateMins = actualStart - expectedStart;
      }
      if (checkIn && checkOut) {
        const [h1, m1] = checkIn.split(':').map(Number);
        const [h2, m2] = checkOut.split(':').map(Number);
        totalHours = ((h2 * 60 + (m2 || 0)) - (h1 * 60 + (m1 || 0))) / 60;
      }

      const status = !checkIn ? 'ABSENT' : lateMins > 0 ? 'LATE' : 'PRESENT';

      await pool.query(`
        INSERT INTO attendance_logs
          (staff_id, date, check_in, check_out, total_hours, late_minutes, status, source, import_batch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'FINGERPRINT_IMPORT', ?)
        ON DUPLICATE KEY UPDATE
          check_in=VALUES(check_in), check_out=VALUES(check_out),
          total_hours=VALUES(total_hours), late_minutes=VALUES(late_minutes),
          status=VALUES(status), import_batch_id=VALUES(import_batch_id)
      `, [staffId, dateStr, checkIn || null, checkOut || null, totalHours, lateMins, status, batchId]);
      imported++;
    }

    await pool.query(`
      UPDATE attendance_import_batches SET status='DONE', rows_imported=?, rows_skipped=?
      WHERE id=?
    `, [imported, skipped, batchId]).catch(() => {});

    res.json({ ok: true, imported, skipped, errors: errors.slice(0, 20) });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/hr/attendance/summary — monthly attendance summary for all staff
router.get('/api/admin/hr/attendance/summary', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();
    const [rows] = await pool.query(`
      SELECT s.id, s.name, s.role, s.image, d.name AS department_name,
        COUNT(CASE WHEN a.status IN ('PRESENT','LATE') THEN 1 END) AS present_days,
        COUNT(CASE WHEN a.status='ABSENT' THEN 1 END) AS absent_days,
        COUNT(CASE WHEN a.status='LATE' THEN 1 END) AS late_days,
        COALESCE(SUM(a.late_minutes),0) AS total_late_minutes,
        COUNT(CASE WHEN a.status='LEAVE' THEN 1 END) AS leave_days,
        COUNT(a.id) AS total_records
      FROM staff s
      LEFT JOIN hr_departments d ON d.id = s.department_id
      LEFT JOIN attendance_logs a ON a.staff_id=s.id AND MONTH(a.date)=? AND YEAR(a.date)=?
      WHERE s.is_active=1
      GROUP BY s.id ORDER BY s.name
    `, [m, y]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v14 — Recruitment
// ══════════════════════════════════════════════════════════════

// List all job postings
router.get('/api/admin/hr/jobs', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT j.*, d.name AS department_name,
        s.name AS posted_by_name,
        (SELECT COUNT(*) FROM job_applicants a WHERE a.job_id=j.id) AS applicant_count
      FROM job_postings j
      LEFT JOIN hr_departments d ON d.id=j.department_id
      LEFT JOIN staff s ON s.id=j.posted_by
      ORDER BY j.created_at DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Create job posting
router.post('/api/admin/hr/jobs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, department_id, employment_type, description, requirements, salary_min, salary_max, status } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO job_postings (id, title, department_id, employment_type, description, requirements, salary_min, salary_max, status, posted_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, title, department_id||null, employment_type||'full_time', description||null, requirements||null,
       salary_min||null, salary_max||null, status||'open', req.staffRecord?.id||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, title, department_id, employment_type, description, requirements,
              salary_min, salary_max, status, posted_by, created_at
       FROM job_postings WHERE id=?`, [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Update job posting
router.put('/api/admin/hr/jobs/:jobId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { jobId } = req.params;
    const fields = ['title','department_id','employment_type','description','requirements','salary_min','salary_max','status'];
    const sets = []; const vals = [];
    for (const f of fields) { if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); } }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(jobId);
    await pool.query(`UPDATE job_postings SET ${sets.join(',')} WHERE id=?`, vals);
    const [[row]] = await pool.query(
      `SELECT id, title, department_id, employment_type, description, requirements,
              salary_min, salary_max, status, posted_by, created_at
       FROM job_postings WHERE id=?`, [jobId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Delete job posting
router.delete('/api/admin/hr/jobs/:jobId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM job_postings WHERE id=?', [req.params.jobId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// List applicants for a job
router.get('/api/admin/hr/jobs/:jobId/applicants', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, s.name AS updated_by_name
       FROM job_applicants a LEFT JOIN staff s ON s.id=a.updated_by
       WHERE a.job_id=? ORDER BY a.created_at DESC`,
      [req.params.jobId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Add applicant
router.post('/api/admin/hr/jobs/:jobId/applicants', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { name, email, phone, cv_url, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO job_applicants (id, job_id, name, email, phone, cv_url, notes, updated_by) VALUES (?,?,?,?,?,?,?,?)`,
      [id, req.params.jobId, name, email||null, phone||null, cv_url||null, notes||null, req.staffRecord?.id||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, job_id, name, email, phone, cv_url, notes, stage, stage_notes, updated_by, created_at, updated_at
       FROM job_applicants WHERE id=?`, [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Update applicant (stage, notes, etc.)
router.put('/api/admin/hr/applicants/:appId', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { appId } = req.params;
    const fields = ['name','email','phone','cv_url','notes','stage','stage_notes'];
    const sets = []; const vals = [];
    for (const f of fields) { if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); } }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    sets.push('updated_by=?'); vals.push(req.staffRecord?.id||null);
    vals.push(appId);
    await pool.query(`UPDATE job_applicants SET ${sets.join(',')} WHERE id=?`, vals);
    const [[row]] = await pool.query(
      `SELECT id, job_id, name, email, phone, cv_url, notes, stage, stage_notes, updated_by, created_at, updated_at
       FROM job_applicants WHERE id=?`, [appId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Delete applicant
router.delete('/api/admin/hr/applicants/:appId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM job_applicants WHERE id=?', [req.params.appId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v14 — Onboarding
// ══════════════════════════════════════════════════════════════

// List templates
router.get('/api/admin/hr/onboarding/templates', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*, COUNT(tk.id) AS task_count
      FROM onboarding_templates t LEFT JOIN onboarding_tasks tk ON tk.template_id=t.id
      GROUP BY t.id ORDER BY t.name
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Create template
router.post('/api/admin/hr/onboarding/templates', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, role, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = uuidv4();
    await pool.query(`INSERT INTO onboarding_templates (id, name, role, description) VALUES (?,?,?,?)`,
      [id, name, role||null, description||null]);
    const [[row]] = await pool.query(
      'SELECT id, name, role, description, created_at FROM onboarding_templates WHERE id=?', [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Update template
router.put('/api/admin/hr/onboarding/templates/:tplId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, role, description } = req.body;
    await pool.query(`UPDATE onboarding_templates SET name=?, role=?, description=? WHERE id=?`,
      [name, role||null, description||null, req.params.tplId]);
    const [[row]] = await pool.query(
      'SELECT id, name, role, description, created_at FROM onboarding_templates WHERE id=?',
      [req.params.tplId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Delete template
router.delete('/api/admin/hr/onboarding/templates/:tplId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM onboarding_tasks WHERE template_id=?', [req.params.tplId]);
    await pool.query('DELETE FROM onboarding_templates WHERE id=?', [req.params.tplId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Get tasks for template
router.get('/api/admin/hr/onboarding/templates/:tplId/tasks', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, template_id, title, description, due_days, category, sort_order
       FROM onboarding_tasks WHERE template_id=? ORDER BY sort_order, id`,
      [req.params.tplId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Add task to template
router.post('/api/admin/hr/onboarding/templates/:tplId/tasks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, description, due_days, category, sort_order } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO onboarding_tasks (id, template_id, title, description, due_days, category, sort_order) VALUES (?,?,?,?,?,?,?)`,
      [id, req.params.tplId, title, description||null, due_days||7, category||'other', sort_order||0]
    );
    const [[row]] = await pool.query(
      'SELECT id, template_id, title, description, due_days, category, sort_order FROM onboarding_tasks WHERE id=?',
      [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Update / delete task
router.put('/api/admin/hr/onboarding/tasks/:taskId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, description, due_days, category, sort_order } = req.body;
    await pool.query(
      `UPDATE onboarding_tasks SET title=?, description=?, due_days=?, category=?, sort_order=? WHERE id=?`,
      [title, description||null, due_days||7, category||'other', sort_order||0, req.params.taskId]
    );
    const [[row]] = await pool.query(
      'SELECT id, template_id, title, description, due_days, category, sort_order FROM onboarding_tasks WHERE id=?',
      [req.params.taskId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/hr/onboarding/tasks/:taskId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM onboarding_tasks WHERE id=?', [req.params.taskId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// List employees with onboarding status
router.get('/api/admin/hr/onboarding/employees', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.id, s.name, s.role, s.image, s.joined_at AS hire_date,
        eo.id AS onboarding_id, eo.status AS onboarding_status, eo.started_at,
        COUNT(eoi.id) AS total_items,
        SUM(CASE WHEN eoi.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done_items,
        t.name AS template_name
      FROM staff s
      LEFT JOIN employee_onboarding eo ON eo.staff_id=s.id AND eo.status IN ('in_progress','completed')
      LEFT JOIN onboarding_templates t ON t.id=eo.template_id
      LEFT JOIN employee_onboarding_items eoi ON eoi.onboarding_id=eo.id
      WHERE s.is_active=1
      GROUP BY s.id, eo.id ORDER BY s.name
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Get onboarding items for an employee onboarding
router.get('/api/admin/hr/onboarding/:onboardingId/items', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, s.name AS completed_by_name
       FROM employee_onboarding_items i LEFT JOIN staff s ON s.id=i.completed_by
       WHERE i.onboarding_id=? ORDER BY i.sort_order, i.id`,
      [req.params.onboardingId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Start onboarding for employee (from template or custom)
router.post('/api/admin/hr/onboarding/start', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { staff_id, template_id, tasks } = req.body; // tasks: [{title,category,due_days}]
    if (!staff_id) return res.status(400).json({ error: 'staff_id required' });
    const onboardingId = uuidv4();
    const [[emp]] = await pool.query('SELECT hire_date FROM staff WHERE id=?', [staff_id]);
    const hireDate = emp?.hire_date ? new Date(emp.hire_date) : new Date();

    await pool.query(`INSERT INTO employee_onboarding (id, staff_id, template_id) VALUES (?,?,?)`,
      [onboardingId, staff_id, template_id||null]);

    let items = [];
    if (template_id) {
      const [tplTasks] = await pool.query(
      `SELECT id, template_id, title, description, due_days, category, sort_order
       FROM onboarding_tasks WHERE template_id=? ORDER BY sort_order`, [template_id]
    );
      items = tplTasks;
    } else if (tasks && Array.isArray(tasks)) {
      items = tasks;
    }

    if (items.length > 0) {
      // Batch INSERT onboarding items (1 query instead of N)
      const onbInsertRows = items.map(() => '(?,?,?,?,?,?)');
      const onbInsertParams = items.flatMap(t => {
        const dueDate = new Date(hireDate);
        dueDate.setDate(dueDate.getDate() + (Number(t.due_days) || 7));
        return [uuidv4(), onboardingId, t.title, t.category||'other', dueDate.toISOString().slice(0,10), t.sort_order||0];
      });
      await pool.query(
        `INSERT INTO employee_onboarding_items (id, onboarding_id, task_title, category, due_date, sort_order) VALUES ${onbInsertRows.join(',')}`,
        onbInsertParams
      );
    }

    const [itemRows] = await pool.query(
      `SELECT id, onboarding_id, task_title, category, due_date, completed_at, completed_by, notes, sort_order
       FROM employee_onboarding_items WHERE onboarding_id=? ORDER BY sort_order`, [onboardingId]
    );
    res.json({ id: onboardingId, items: itemRows });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Toggle onboarding item complete/incomplete
router.put('/api/admin/hr/onboarding/items/:itemId', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { done, notes } = req.body;
    const now = done ? new Date().toISOString().slice(0,19).replace('T',' ') : null;
    await pool.query(
      `UPDATE employee_onboarding_items SET completed_at=?, completed_by=?, notes=COALESCE(?,notes) WHERE id=?`,
      [now, done ? (req.staffRecord?.id||null) : null, notes||null, req.params.itemId]
    );
    // auto-complete onboarding if all items done
    const [[item]] = await pool.query('SELECT onboarding_id FROM employee_onboarding_items WHERE id=?', [req.params.itemId]);
    if (item) {
      const [[cnt]] = await pool.query(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done FROM employee_onboarding_items WHERE onboarding_id=?`,
        [item.onboarding_id]
      );
      if (cnt.total > 0 && cnt.total === cnt.done) {
        await pool.query(`UPDATE employee_onboarding SET status='completed', completed_at=NOW() WHERE id=?`, [item.onboarding_id]);
      } else {
        await pool.query(`UPDATE employee_onboarding SET status='in_progress', completed_at=NULL WHERE id=?`, [item.onboarding_id]);
      }
    }
    const [[row]] = await pool.query(
      `SELECT id, onboarding_id, task_title, category, due_date, completed_at, completed_by, notes, sort_order
       FROM employee_onboarding_items WHERE id=?`, [req.params.itemId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v14 — BI Reports
// ══════════════════════════════════════════════════════════════

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
router.get('/api/admin/hr/advances', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staff_id, status } = req.query;
    let sql = `SELECT a.*, s.name AS staff_name, s.role, s.image,
        ap.name AS approved_by_name
      FROM salary_advances a
      JOIN staff s ON s.id=a.staff_id
      LEFT JOIN staff ap ON ap.id=a.approved_by
      WHERE 1=1`;
    const params = [];
    if (staff_id) { sql += ' AND a.staff_id=?'; params.push(staff_id); }
    if (status)   { sql += ' AND a.status=?';   params.push(status); }
    sql += ' ORDER BY a.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Request an advance (any staff for themselves, admin for anyone)
router.post('/api/admin/hr/advances', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staff_id, amount, currency, reason, deduct_month, deduct_year } = req.body;
    if (!staff_id || !amount) return res.status(400).json({ error: 'staff_id and amount required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO salary_advances (id, staff_id, amount, currency, reason, deduct_month, deduct_year) VALUES (?,?,?,?,?,?,?)`,
      [id, staff_id, amount, currency||'EGP', reason||null, deduct_month||null, deduct_year||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, staff_id, amount, currency, reason, status, deduct_month, deduct_year,
              approved_by, approved_at, created_at FROM salary_advances WHERE id=?`, [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Approve / reject advance
router.put('/api/admin/hr/advances/:advId/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, deduct_month, deduct_year } = req.body;
    if (!['APPROVED','REJECTED','DEDUCTED'].includes(status)) return res.status(400).json({ error: 'invalid status' });
    await pool.query(
      `UPDATE salary_advances SET status=?, approved_by=?, approved_at=NOW(),
        deduct_month=COALESCE(?,deduct_month), deduct_year=COALESCE(?,deduct_year)
       WHERE id=?`,
      [status, req.staffRecord?.id||null, deduct_month||null, deduct_year||null, req.params.advId]
    );
    const [[row]] = await pool.query(
      `SELECT id, staff_id, amount, currency, reason, status, deduct_month, deduct_year,
              approved_by, approved_at, created_at FROM salary_advances WHERE id=?`,
      [req.params.advId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Delete advance (admin, pending only)
router.delete('/api/admin/hr/advances/:advId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM salary_advances WHERE id=? AND status='PENDING'`, [req.params.advId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v15 — Disciplinary Records
// ══════════════════════════════════════════════════════════════

router.get('/api/admin/hr/disciplinary', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staff_id } = req.query;
    let sql = `SELECT d.*, s.name AS staff_name, s.role, s.image,
        i.name AS issued_by_name
      FROM disciplinary_records d
      JOIN staff s ON s.id=d.staff_id
      LEFT JOIN staff i ON i.id=d.issued_by
      WHERE 1=1`;
    const params = [];
    if (staff_id) { sql += ' AND d.staff_id=?'; params.push(staff_id); }
    sql += ' ORDER BY d.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/hr/disciplinary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { staff_id, type, severity, title, description, incident_date, action_taken } = req.body;
    if (!staff_id || !title) return res.status(400).json({ error: 'staff_id and title required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO disciplinary_records (id, staff_id, type, severity, title, description, incident_date, action_taken, issued_by) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, staff_id, type||'warning', severity||'medium', title, description||null, incident_date||null, action_taken||null, req.staffRecord?.id||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, staff_id, type, severity, title, description, incident_date, action_taken,
              issued_by, acknowledged_at, acknowledged_by, status, created_at
       FROM disciplinary_records WHERE id=?`, [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/hr/disciplinary/:recId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const fields = ['type','severity','title','description','incident_date','action_taken','status'];
    const sets = []; const vals = [];
    for (const f of fields) { if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); } }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(req.params.recId);
    await pool.query(`UPDATE disciplinary_records SET ${sets.join(',')} WHERE id=?`, vals);
    const [[row]] = await pool.query(
      `SELECT id, staff_id, type, severity, title, description, incident_date, action_taken,
              issued_by, acknowledged_at, acknowledged_by, status, created_at
       FROM disciplinary_records WHERE id=?`, [req.params.recId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Acknowledge (by the employee themselves)
router.put('/api/admin/hr/disciplinary/:recId/acknowledge', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    await pool.query(
      `UPDATE disciplinary_records SET acknowledged_at=NOW(), acknowledged_by=?, status='acknowledged' WHERE id=?`,
      [req.staffRecord?.id||null, req.params.recId]
    );
    const [[row]] = await pool.query(
      `SELECT id, staff_id, type, severity, title, description, incident_date, action_taken,
              issued_by, acknowledged_at, acknowledged_by, status, created_at
       FROM disciplinary_records WHERE id=?`, [req.params.recId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/hr/disciplinary/:recId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM disciplinary_records WHERE id=?', [req.params.recId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v15 — Employee Documents Vault
// ══════════════════════════════════════════════════════════════

router.get('/api/admin/hr/documents', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staff_id } = req.query;
    let sql = `SELECT d.*, u.name AS uploaded_by_name
      FROM employee_documents d LEFT JOIN staff u ON u.id=d.uploaded_by
      WHERE 1=1`;
    const params = [];
    if (staff_id) { sql += ' AND d.staff_id=?'; params.push(staff_id); }
    sql += ' ORDER BY d.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/hr/documents', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staff_id, title, category, file_url, file_name, expiry_date } = req.body;
    if (!staff_id || !title) return res.status(400).json({ error: 'staff_id and title required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO employee_documents (id, staff_id, title, category, file_url, file_name, expiry_date, uploaded_by) VALUES (?,?,?,?,?,?,?,?)`,
      [id, staff_id, title, category||'other', file_url||null, file_name||null, expiry_date||null, req.staffRecord?.id||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, staff_id, title, category, file_url, file_name, expiry_date, uploaded_by, created_at
       FROM employee_documents WHERE id=?`, [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/hr/documents/:docId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM employee_documents WHERE id=?', [req.params.docId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Self-service: get own advances + disciplinary (read-only)
router.get('/api/staff/me/advances', requireAuth, async (req, res) => {
  try {
    const staffId = await getStaffIdByEmail(req.user?.email);
    if (!staffId) return res.json([]);
    const [rows] = await pool.query(
      `SELECT a.*, ap.name AS approved_by_name
       FROM salary_advances a LEFT JOIN staff ap ON ap.id=a.approved_by
       WHERE a.staff_id=? ORDER BY a.created_at DESC`,
      [staffId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Self-service: submit own advance request
router.post('/api/staff/me/advances', requireAuth, async (req, res) => {
  try {
    const staffId = await getStaffIdByEmail(req.user?.email);
    if (!staffId) return res.status(403).json({ error: 'Staff record not found' });
    const { amount, currency, reason } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO salary_advances (id, staff_id, amount, currency, reason) VALUES (?,?,?,?,?)`,
      [id, staffId, amount, currency||'EGP', reason||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, staff_id, amount, currency, reason, status, deduct_month, deduct_year,
              approved_by, approved_at, created_at FROM salary_advances WHERE id=?`, [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Self-service: get own documents
router.get('/api/staff/me/documents', requireAuth, async (req, res) => {
  try {
    const staffId = await getStaffIdByEmail(req.user?.email);
    if (!staffId) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id, staff_id, title, category, file_url, file_name, expiry_date, uploaded_by, created_at
       FROM employee_documents WHERE staff_id=? ORDER BY created_at DESC`,
      [staffId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v16 — Instructor Rates
// ══════════════════════════════════════════════════════════════

router.get('/api/admin/hr/instructors/:staffId/rates', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT id, staff_id, consultation_rate_type, consultation_rate_value, lecture_rate_per_hour,
              training_rate_per_hour, currency, notes, updated_at
       FROM instructor_rates WHERE staff_id=?`, [req.params.staffId]
    );
    res.json(row || null);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/hr/instructors/:staffId/rates', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { consultation_rate_type, consultation_rate_value, lecture_rate_per_hour, training_rate_per_hour, currency, notes } = req.body;
    await pool.query(
      `INSERT INTO instructor_rates (id, staff_id, consultation_rate_type, consultation_rate_value, lecture_rate_per_hour, training_rate_per_hour, currency, notes)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         consultation_rate_type=VALUES(consultation_rate_type),
         consultation_rate_value=VALUES(consultation_rate_value),
         lecture_rate_per_hour=VALUES(lecture_rate_per_hour),
         training_rate_per_hour=VALUES(training_rate_per_hour),
         currency=VALUES(currency), notes=VALUES(notes), updated_at=NOW()`,
      [req.params.staffId, consultation_rate_type||'per_session', consultation_rate_value||0,
       lecture_rate_per_hour||0, training_rate_per_hour||0, currency||'EGP', notes||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, staff_id, consultation_rate_type, consultation_rate_value, lecture_rate_per_hour,
              training_rate_per_hour, currency, notes, updated_at
       FROM instructor_rates WHERE staff_id=?`, [req.params.staffId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v16 — Employee Bonuses & Deductions
// ══════════════════════════════════════════════════════════════

router.get('/api/admin/hr/employees/:staffId/bonuses', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.*, c.name AS created_by_name
       FROM employee_bonuses b LEFT JOIN staff c ON c.id=b.created_by
       WHERE b.staff_id=? ORDER BY b.created_at DESC`,
      [req.params.staffId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/hr/employees/:staffId/bonuses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { type, amount, currency, reason, for_month, for_year } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO employee_bonuses (id, staff_id, type, amount, currency, reason, for_month, for_year, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, req.params.staffId, type||'bonus', amount, currency||'EGP', reason||null, for_month||null, for_year||null, req.staffRecord?.id||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, staff_id, type, amount, currency, reason, for_month, for_year, created_by, created_at
       FROM employee_bonuses WHERE id=?`, [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/hr/bonuses/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM employee_bonuses WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v20 — Instructor Fees (lecture/training/consultation fees per month)
// ══════════════════════════════════════════════════════════════

// GET /api/admin/hr/instructor-fees?staffId=&month=&year=&status=
router.get('/api/admin/hr/instructor-fees', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staffId, month, year, status } = req.query;
    let sql = `SELECT f.*, s.name AS staff_name, c.title AS course_title
               FROM instructor_fees f
               LEFT JOIN staff s ON s.id = f.staff_id
               LEFT JOIN courses c ON c.id = f.course_id
               WHERE 1`;
    const params = [];
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
router.post('/api/admin/hr/instructor-fees', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { staff_id, course_id, daqqi_round_id, fee_type, hours, rate_per_hour, fixed_amount, currency, period_month, period_year, note } = req.body;
    if (!staff_id) return res.status(400).json({ error: 'staff_id required' });
    const total = fixed_amount
      ? Number(fixed_amount)
      : (Number(hours || 0) * Number(rate_per_hour || 0));
    const id = uuidv4();
    await pool.query(
      `INSERT INTO instructor_fees (id, staff_id, course_id, daqqi_round_id, fee_type, hours, rate_per_hour, fixed_amount, total_amount, currency, period_month, period_year, note, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, staff_id, course_id||null, daqqi_round_id||null, fee_type||'lecture',
       hours||null, rate_per_hour||null, fixed_amount||null, total,
       currency||'EGP', period_month||null, period_year||null, note||null, req.user?.id||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, staff_id, course_id, daqqi_round_id, fee_type, hours, rate_per_hour, fixed_amount,
              total_amount, currency, period_month, period_year, status, note, created_by, created_at
       FROM instructor_fees WHERE id=?`, [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/hr/instructor-fees/:id — update status (approve/mark paid)
router.patch('/api/admin/hr/instructor-fees/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, note } = req.body;
    const allowed = ['pending','approved','paid'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    const sets = [];
    const params = [];
    if (status) { sets.push('status=?'); params.push(status); }
    if (note !== undefined) { sets.push('note=?'); params.push(note); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    params.push(req.params.id);
    await pool.query(`UPDATE instructor_fees SET ${sets.join(',')} WHERE id=?`, params);
    const [[row]] = await pool.query(
      `SELECT id, staff_id, course_id, daqqi_round_id, fee_type, hours, rate_per_hour, fixed_amount,
              total_amount, currency, period_month, period_year, status, note, created_by, created_at
       FROM instructor_fees WHERE id=?`, [req.params.id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/hr/instructor-fees/:id
router.delete('/api/admin/hr/instructor-fees/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM instructor_fees WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/staff/me/leaves', requireAuth, async (req, res) => {
  try {
    const staffId = await getStaffIdByEmail(req.user?.email);
    if (!staffId) return res.status(403).json({ error: 'Staff record not found' });
    const { type, start_date, end_date, reason } = req.body;
    if (!type || !start_date || !end_date) return res.status(400).json({ error: 'type, start_date, end_date required' });
    const start = new Date(start_date);
    const end   = new Date(end_date);
    if (isNaN(start) || isNaN(end) || end < start) return res.status(400).json({ error: 'Invalid dates' });
    const totalDays = Math.ceil((end - start) / 86400000) + 1;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO leave_requests (id, staff_id, type, start_date, end_date, total_days, reason, status)
       VALUES (?,?,?,?,?,?,?,'PENDING')`,
      [id, staffId, type, start_date, end_date, totalDays, reason || null]
    );
    const [[row]] = await pool.query(
      'SELECT id, staff_id, type, start_date, end_date, total_days, reason, status FROM leave_requests WHERE id=?',
      [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/staff/me/payslip', requireAuth, async (req, res) => {
  try {
    const staffId = await getStaffIdByEmail(req.user?.email);
    if (!staffId) return res.status(404).json({ error: 'Staff record not found' });
    const m = Number(req.query.month) || new Date().getMonth() + 1;
    const y = Number(req.query.year)  || new Date().getFullYear();
    const [[item]] = await pool.query(`
      SELECT pi.*, pr.month, pr.year, pr.status AS run_status,
             s.name AS staff_name, s.role, d.name AS department_name
      FROM payroll_items pi
      JOIN payroll_runs pr ON pr.id=pi.payroll_run_id
      JOIN staff s ON s.id=pi.staff_id
      LEFT JOIN hr_departments d ON d.id=s.department_id
      WHERE pi.staff_id=? AND pr.month=? AND pr.year=? AND pr.status IN ('APPROVED','PAID')
      LIMIT 1
    `, [staffId, m, y]);
    if (!item) return res.json(null);
    res.json(item);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/staff/me/commissions', requireAuth, async (req, res) => {
  try {
    const staffId = await getStaffIdByEmail(req.user?.email);
    if (!staffId) return res.status(404).json({ error: 'Staff record not found' });
    const m = Number(req.query.month) || null;
    const y = Number(req.query.year)  || null;
    let sql = `SELECT c.id, c.payment_amount, c.commission_amount, c.month, c.year,
                      c.status, c.created_at, s.name AS client_name
               FROM crm_commissions c
               LEFT JOIN subscribers s ON s.id=c.client_id
               WHERE c.staff_id=?`;
    const params = [staffId];
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
    const staffId = await getStaffIdByEmail(req.user.email);
    if (!staffId) return res.status(403).json({ error: 'Not a staff member' });
    const [rows] = await pool.query(
      'SELECT id, staff_id, day_of_week, start_time, end_time, grace_minutes, is_off_day FROM work_schedules WHERE staff_id = ? ORDER BY day_of_week', [staffId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/staff/me/appraisals', requireAuth, async (req, res) => {
  try {
    const staffId = await getStaffIdByEmail(req.user.email);
    if (!staffId) return res.status(403).json({ error: 'Not a staff member' });
    const [rows] = await pool.query(
      `SELECT id, staff_id, reviewer_email, period_month, period_year, kpi_scores, overall_score,
              grade, notes, status, created_at, updated_at
       FROM performance_appraisals WHERE staff_id = ? ORDER BY period_year DESC, period_month DESC`,
      [staffId]
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
router.get('/api/admin/hr/attendance-report', requireAuth, requireAdmin, async (req, res) => {
  try {
    const month = (req.query.month || new Date().toISOString().slice(0, 7));
    const [y, m] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const monthEnd   = new Date(y, m, 1).toISOString().slice(0, 10); // first day of next month

    // All active staff
    const [staff] = await pool.query(
      `SELECT id, name, email, role, employment_type FROM staff WHERE is_active = 1 ORDER BY name ASC`
    );

    // Absence records for the month
    const [absences] = await pool.query(
      `SELECT staff_id, type, date, COUNT(*) AS cnt
       FROM staff_absences
       WHERE date >= ? AND date < ?
       GROUP BY staff_id, type, date`,
      [monthStart, monthEnd]
    ).catch(() => [[]]);

    // Leave requests approved for the month
    const [leaves] = await pool.query(
      `SELECT staff_id, leave_type, status,
              DATEDIFF(LEAST(end_date, ?), GREATEST(start_date, ?)) + 1 AS days_in_month
       FROM leave_requests
       WHERE status = 'APPROVED'
         AND start_date < ? AND end_date >= ?`,
      [monthEnd, monthStart, monthEnd, monthStart]
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
