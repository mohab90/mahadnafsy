'use strict';
const { Router } = require('express');
const router = Router();
const { logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');

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
      INSERT INTO attendance_import_batches (id, filename, month, year, imported_by)
      VALUES (?, ?, ?, ?, ?)
    `, [batchId, filename || 'import.csv', m, y, req.user?.uid || null]).catch(() => {});

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
      UPDATE attendance_import_batches SET rows_ok=?, rows_error=?
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
module.exports = router;
