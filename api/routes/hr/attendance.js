'use strict';
const { Router } = require('express');
const router = Router();
const { logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');

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

// ── Staff self-service attendance (check-in / check-out) ─────────────────────
// Lets a staff member clock in/out from their own dashboard → feeds attendance_logs
// (source APP) which payroll + attendance reports already consume. This is the
// integration that was missing (attendance was admin-manual/import only).
router.get('/api/me/hr/attendance/today', requireAuth, async (req, res) => {
  try {
    const st = await _resolveStaffByUser(req);
    if (!st) return res.json({ isStaff: false });
    const [[row]] = await pool.query(
      'SELECT check_in, check_out, status, total_hours, late_minutes FROM attendance_logs WHERE staff_id=? AND date=CURDATE() LIMIT 1', [st.id]);
    res.json({ isStaff: true, staffName: st.name, today: row || null });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/me/hr/attendance/check-in', requireAuth, async (req, res) => {
  try {
    const st = await _resolveStaffByUser(req);
    if (!st) return res.status(403).json({ error: 'not_staff' });
    const now = new Date();
    const checkIn = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const minutesIn = now.getHours() * 60 + now.getMinutes();
    const lateMin = minutesIn > (9 * 60 + 15) ? minutesIn - (9 * 60 + 15) : 0;
    const status = lateMin > 0 ? 'LATE' : 'PRESENT';
    await pool.query(
      `INSERT INTO attendance_logs (id, staff_id, date, check_in, late_minutes, status, source)
       VALUES (UUID(), ?, CURDATE(), ?, ?, ?, 'APP')
       ON DUPLICATE KEY UPDATE check_in=IF(check_in IS NULL, VALUES(check_in), check_in),
         late_minutes=VALUES(late_minutes), status=IF(status='ABSENT', VALUES(status), status), source='APP'`,
      [st.id, checkIn, lateMin, status]);
    res.json({ ok: true, check_in: checkIn, status });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/me/hr/attendance/check-out', requireAuth, async (req, res) => {
  try {
    const st = await _resolveStaffByUser(req);
    if (!st) return res.status(403).json({ error: 'not_staff' });
    const now = new Date();
    const checkOut = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const [[row]] = await pool.query('SELECT check_in FROM attendance_logs WHERE staff_id=? AND date=CURDATE() LIMIT 1', [st.id]);
    let totalHours = null;
    if (row?.check_in) {
      const [hi, mi] = String(row.check_in).split(':').map(Number);
      totalHours = Math.round(((now.getHours() * 60 + now.getMinutes()) - (hi * 60 + mi)) / 60 * 100) / 100;
    }
    await pool.query(
      `INSERT INTO attendance_logs (id, staff_id, date, check_out, total_hours, status, source)
       VALUES (UUID(), ?, CURDATE(), ?, ?, 'PRESENT', 'APP')
       ON DUPLICATE KEY UPDATE check_out=VALUES(check_out), total_hours=VALUES(total_hours)`,
      [st.id, checkOut, totalHours]);
    res.json({ ok: true, check_out: checkOut, total_hours: totalHours });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
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

    // Customer-service performance for this agent (interconnects CS ↔ HR): how
    // many tickets they handled, resolution rate, first-response speed + SLA.
    let cs = { tickets_assigned: 0, tickets_resolved: 0, avg_first_response_min: null, sla_compliance: null };
    try {
      const [[row]] = await pool.query(`
        SELECT COUNT(*) AS tickets_assigned,
               SUM(status IN ('resolved','closed')) AS tickets_resolved,
               AVG(CASE WHEN first_response_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, created_at, first_response_at) END) AS avg_first_response_min,
               SUM(first_response_at IS NOT NULL) AS responded,
               SUM(first_response_at IS NOT NULL AND (sla_due_at IS NULL OR first_response_at <= sla_due_at)) AS sla_met
          FROM support_tickets
         WHERE assigned_to=? AND MONTH(created_at)=? AND YEAR(created_at)=?`, [staffId, m, y]);
      cs = {
        tickets_assigned: Number(row.tickets_assigned || 0),
        tickets_resolved: Number(row.tickets_resolved || 0),
        avg_first_response_min: row.avg_first_response_min != null ? Math.round(row.avg_first_response_min) : null,
        sla_compliance: row.responded ? Math.round((row.sla_met / row.responded) * 100) : null,
      };
    } catch { /* support_tickets SLA cols may predate migration 030 */ }

    res.json({ actuals, targets, history, cs });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// HR — PAYROLL
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/hr/payroll — list payroll runs
module.exports = router;
