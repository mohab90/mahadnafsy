'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, requireAnyPermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, logFinancialAudit, _resolveStaffByUser } = require('./_shared');
const { hasPermission } = require('../../constants/permissions');
const { getEffectiveHrPolicy } = require('../../lib/hrPolicy');
const { getFxToEgp } = require('../../lib/finance');

function parseCsvRow(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  fields.push(value.trim());
  return fields;
}

const validClockTime = value => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));
const clockMinutes = value => {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return hours * 60 + minutes;
};

router.get('/api/admin/hr/payroll', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [runs] = await pool.query(`
      SELECT pr.*,
        s.name AS calculated_by_name,
        s2.name AS approved_by_name
      FROM payroll_runs pr
      LEFT JOIN staff s  ON s.id=pr.calculated_by AND s.tenant_id=pr.tenant_id
      LEFT JOIN staff s2 ON s2.id=pr.approved_by AND s2.tenant_id=pr.tenant_id
      WHERE pr.tenant_id=?
      ORDER BY pr.year DESC, pr.month DESC
      LIMIT 24
    `, [req.tenantId]);
    res.json(runs);
  } catch (e) { logger.error('[hr/payroll]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/hr/payroll/calculate — calculate payroll for a month
router.post('/api/admin/hr/payroll/calculate', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { month, year, notes } = req.body;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();
    // Guard against malformed input (e.g. a combined "YYYY-MM" string) overflowing
    // the small month/year columns and surfacing as an opaque 500.
    if (m < 1 || m > 12 || y < 2000 || y > 2100) {
      return res.status(400).json({ error: 'شهر أو سنة غير صالحة' });
    }
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const branchId = req.body?.branch_id || 'branch-all';
    const allowedBranchIds = new Set(['branch-all', 'branch-other', 'branch-daqqi', 'branch-tagamoa', 'branch-online-egypt', 'branch-online-saudi', 'branch-online-abroad']);
    if (!allowedBranchIds.has(branchId)) return res.status(400).json({ error: 'فرع غير صالح' });
    const actorId = req.staffRecord?.id || req.user?.uid || null;
    await conn.beginTransaction();
    transactionStarted = true;
    await conn.query(
      'INSERT IGNORE INTO payroll_period_locks (tenant_id,year,month) VALUES (?,?,?)',
      [tenantId, y, m]
    );
    await conn.query(
      'SELECT tenant_id FROM payroll_period_locks WHERE tenant_id=? AND year=? AND month=? FOR UPDATE',
      [tenantId, y, m]
    );
    const [overlappingRuns] = await conn.query(
      `SELECT id,branch_id,status FROM payroll_runs
        WHERE tenant_id=? AND year=? AND month=? AND status<>'CANCELLED'
          AND branch_id<>?
          AND (branch_id='branch-all' OR ?='branch-all')
        LIMIT 1`,
      [tenantId, y, m, branchId, branchId]
    );
    if (overlappingRuns.length) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({
        error: 'A whole-tenant payroll run cannot overlap branch payroll runs for the same month',
        code: 'PAYROLL_SCOPE_OVERLAP',
        conflicting_run_id: overlappingRuns[0].id,
      });
    }
    const policy = await getEffectiveHrPolicy(
      conn, tenantId, `${y}-${String(m).padStart(2, '0')}-01`
    );
    const workDaysPerMonth = Number(policy.work_days_per_month || 26);
    const workdayMinutes = Number(policy.workday_minutes || 480);

    // Create-or-lock the scoped run without mutating an approved/paid run. The
    // unique (tenant,branch,month,year) key serializes concurrent calculations.
    await conn.query(`
      INSERT IGNORE INTO payroll_runs (month, year, status, notes, calculated_by, tenant_id, branch_id, calculated_at)
      VALUES (?, ?, 'CALCULATED', ?, ?, ?, ?, NOW())
    `, [m, y, notes || null, actorId, tenantId, branchId]);

    const [[run]] = await conn.query(`SELECT id,status FROM payroll_runs WHERE month=? AND year=? AND tenant_id=? AND branch_id=? FOR UPDATE`, [m, y, tenantId, branchId]);
    if (!run || !['DRAFT', 'CALCULATED'].includes(run.status)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'لا يمكن إعادة احتساب مسير معتمد أو مدفوع أو ملغي' });
    }
    const runId = run.id;
    await conn.query(
      "UPDATE payroll_runs SET status='CALCULATED',notes=?,calculated_by=?,calculated_at=NOW() WHERE id=? AND tenant_id=?",
      [notes || null, actorId, runId, tenantId]
    );
    // A recalculation is a full deterministic rebuild. Release only commissions
    // previously reserved by this run, then remove stale staff items.
    await conn.query(
      "UPDATE crm_commissions SET status='PENDING',payroll_run_id=NULL WHERE payroll_run_id=? AND tenant_id=? AND status='INCLUDED_IN_PAYROLL'",
      [runId, tenantId]
    );
    await conn.query(
      "UPDATE instructor_fees SET status='approved',payroll_run_id=NULL WHERE payroll_run_id=? AND tenant_id=? AND status='included_in_payroll'",
      [runId, tenantId]
    );
    await conn.query('DELETE FROM payroll_items WHERE payroll_run_id=? AND tenant_id=?', [runId, tenantId]);

    // Get all active staff with salary structures
    const [employees] = await conn.query(`
      SELECT s.id AS staff_id, s.name, s.commission_rate,
        ss.base_salary, ss.housing_allowance, ss.transport_allowance,
        ss.food_allowance, ss.other_fixed, ss.deduction_social_insurance, ss.deduction_tax,
        ss.other_allowances_json,ss.currency AS salary_currency
      FROM staff s
      LEFT JOIN salary_structures ss ON ss.staff_id=s.id AND ss.tenant_id=s.tenant_id
        AND ss.status='APPROVED'
        AND ss.effective_from<=LAST_DAY(STR_TO_DATE(CONCAT(?, '-', ?, '-01'),'%Y-%m-%d'))
        AND (ss.effective_to IS NULL OR ss.effective_to>=STR_TO_DATE(CONCAT(?, '-', ?, '-01'),'%Y-%m-%d'))
        AND NOT EXISTS (
          SELECT 1 FROM salary_structures newer
           WHERE newer.tenant_id=ss.tenant_id AND newer.staff_id=ss.staff_id
             AND newer.status='APPROVED'
             AND newer.effective_from<=LAST_DAY(STR_TO_DATE(CONCAT(?, '-', ?, '-01'),'%Y-%m-%d'))
             AND (newer.effective_to IS NULL OR newer.effective_to>=STR_TO_DATE(CONCAT(?, '-', ?, '-01'),'%Y-%m-%d'))
             AND newer.effective_from>ss.effective_from
        )
       WHERE s.is_active=1 AND s.deleted_at IS NULL AND s.tenant_id=?
         AND (?='branch-all' OR s.branch_id=?)
    `, [y, m, y, m, y, m, y, m, tenantId, branchId, branchId]);
    const missingSalary = employees.filter(employee => employee.base_salary == null);
    if (missingSalary.length) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(409).json({
        error: 'Payroll cannot be calculated while active employees are missing an approved salary structure',
        code: 'PAYROLL_SALARY_MISSING',
        staff: missingSalary.slice(0, 20).map(employee => ({ id: employee.staff_id, name: employee.name })),
        missingCount: missingSalary.length,
      });
    }

    // ── Batch-fetch all payroll metrics (avoid N+1 — one query per metric for ALL staff) ──
    const empIds = employees.map(e => e.staff_id);
    let totalAmount = 0;

    // Batch attendance stats
    const [attBatch] = empIds.length ? await conn.query(`
      SELECT a.staff_id,
        COUNT(CASE WHEN a.status='ABSENT' THEN 1 END) AS absent_days,
        COALESCE(SUM(CASE WHEN a.leave_id IS NOT NULL AND l.type='UNPAID'
                          THEN IF(a.status='HALF_DAY',0.5,1) ELSE 0 END),0) AS unpaid_leave_days,
        COALESCE(SUM(a.late_minutes), 0) AS late_minutes,
        COALESCE(SUM(CASE WHEN a.status IN ('PRESENT','LATE','REMOTE') THEN 1
                          WHEN a.status='HALF_DAY' THEN 0.5 ELSE 0 END),0) AS present_days
      FROM attendance_logs a
      LEFT JOIN leaves l ON l.tenant_id=a.tenant_id AND l.id=a.leave_id
      WHERE a.tenant_id=? AND a.staff_id IN (?) AND MONTH(a.date)=? AND YEAR(a.date)=?
      GROUP BY a.staff_id
    `, [tenantId, empIds, m, y]) : [[]];
    const attMap = Object.fromEntries(attBatch.map(r => [r.staff_id, r]));

    // Batch commissions — UNIFIED source: crm_commissions rows written at payment time
    // by commission_rules (same numbers sales sees in their dashboard). Only staff with
    // no commission rows this month fall back to flat staff.commission_rate over sales.
    const [ccBatch] = empIds.length ? await conn.query(`
      SELECT staff_id, COALESCE(SUM(commission_amount),0) AS amt, COUNT(*) AS cnt
      FROM crm_commissions
      WHERE staff_id IN (?) AND month=? AND year=? AND tenant_id=? AND status IN ('PENDING','INCLUDED_IN_PAYROLL')
      GROUP BY staff_id
    `, [empIds, m, y, tenantId]) : [[]];
    const ccMap = Object.fromEntries(ccBatch.map(r => [r.staff_id, { amt: parseFloat(r.amt) || 0, cnt: parseInt(r.cnt) || 0 }]));

    // Fallback sales sums — grouped per currency and converted to EGP so SAR/USD
    // payments don't get added as if they were EGP.
    const [commBatch] = empIds.length ? await conn.query(`
      SELECT staff_id, COALESCE(SUM(amount_egp),0) AS total_sales
      FROM payments
      WHERE staff_id IN (?) AND status='paid' AND tenant_id=? AND deleted_at IS NULL AND MONTH(date)=? AND YEAR(date)=?
      GROUP BY staff_id
    `, [empIds, tenantId, m, y]) : [[]];
    const commMap = Object.fromEntries(commBatch.map(r => [r.staff_id, parseFloat(r.total_sales) || 0]));

    // Batch advance deductions
    const [advBatch] = empIds.length ? await conn.query(`
      SELECT staff_id,currency,COALESCE(SUM(amount),0) AS advances
      FROM salary_advances
      WHERE tenant_id=? AND staff_id IN (?) AND deduct_month=? AND deduct_year=? AND status='DISBURSED'
      GROUP BY staff_id,currency
    `, [tenantId, empIds, m, y]) : [[]];

    const [bonusBatch] = empIds.length ? await conn.query(
      `SELECT staff_id,type,currency,COALESCE(SUM(amount),0) amount
         FROM employee_bonuses
        WHERE tenant_id=? AND staff_id IN (?) AND for_month=? AND for_year=? AND status='APPROVED'
        GROUP BY staff_id,type,currency`,
      [tenantId, empIds, m, y]
    ) : [[]];
    const [feeBatch] = empIds.length ? await conn.query(
      `SELECT staff_id,currency,COALESCE(SUM(total_amount),0) amount,COUNT(*) count
         FROM instructor_fees
        WHERE tenant_id=? AND staff_id IN (?) AND period_month=? AND period_year=? AND status='approved'
        GROUP BY staff_id,currency`,
      [tenantId, empIds, m, y]
    ) : [[]];
    const fxRates = await getFxToEgp(tenantId);
    const advMap = {};
    for (const row of advBatch) {
      const currency = String(row.currency || 'EGP').toUpperCase();
      advMap[row.staff_id] = (advMap[row.staff_id] || 0)
        + Number(row.advances || 0) * Number(fxRates[currency] || 1);
    }
    const bonusMap = {};
    for (const row of bonusBatch) {
      const amounts = bonusMap[row.staff_id] ||= { bonus: 0, deduction: 0 };
      amounts[row.type] += Number(row.amount || 0) * Number(fxRates[String(row.currency || 'EGP').toUpperCase()] || 1);
    }
    const feeMap = {};
    for (const row of feeBatch) {
      const fees = feeMap[row.staff_id] ||= { amount: 0, count: 0 };
      fees.amount += Number(row.amount || 0) * Number(fxRates[String(row.currency || 'EGP').toUpperCase()] || 1);
      fees.count += Number(row.count || 0);
    }

    // For each employee, calculate net salary (now pure in-memory — no per-employee DB queries for att/comm/adv)
    for (const emp of employees) {
      const salaryCurrency = String(emp.salary_currency || 'EGP').toUpperCase();
      const salaryFx = Number(fxRates[salaryCurrency] || 1);
      const baseSalary = (parseFloat(emp.base_salary) || 0) * salaryFx;
      const housing    = (parseFloat(emp.housing_allowance) || 0) * salaryFx;
      const transport  = (parseFloat(emp.transport_allowance) || 0) * salaryFx;
      const food       = (parseFloat(emp.food_allowance) || 0) * salaryFx;
      const otherFixed = (parseFloat(emp.other_fixed) || 0) * salaryFx;
      const dedSocial  = (parseFloat(emp.deduction_social_insurance) || 0) * salaryFx;
      const dedTax     = (parseFloat(emp.deduction_tax) || 0) * salaryFx;
      const totalAllowances = housing + transport + food + otherFixed;

      // Attendance from batch map
      const attStats = attMap[emp.staff_id] || { absent_days: 0, late_minutes: 0, present_days: 0 };
      const unpaidLeaveDays = Number(attStats.unpaid_leave_days) || 0;
      const absentDays   = (Number(attStats.absent_days) || 0) + unpaidLeaveDays;
      const lateMins     = parseInt(attStats.late_minutes) || 0;
      const presentDays  = Number(attStats.present_days) || 0;

      const dailyRate   = baseSalary / workDaysPerMonth;
      const minuteRate  = baseSalary / (workDaysPerMonth * workdayMinutes);
      const absenceDeduction = dailyRate * absentDays;
      const lateDeduction    = minuteRate * lateMins;

      // Commission — unified: crm_commissions first, flat-rate fallback (EGP-converted sales)
      const ccRow = ccMap[emp.staff_id];
      const totalSales = commMap[emp.staff_id] || 0;
      let commission, commissionCount, commissionSource;
      if (ccRow && ccRow.cnt > 0) {
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

      const instructorEarnings = feeMap[emp.staff_id]?.amount || 0;
      const bonusTotal = bonusMap[emp.staff_id]?.bonus || 0;
      const deductionTotal = bonusMap[emp.staff_id]?.deduction || 0;

      const grossSalary = baseSalary + totalAllowances + commission + instructorEarnings + bonusTotal;
      const totalDeductions = dedSocial + dedTax + absenceDeduction + lateDeduction + advanceDeduction + deductionTotal;
      const netSalary = Math.max(0, grossSalary - totalDeductions);
      totalAmount += netSalary;

      const allowancesJson = JSON.stringify({ housing, transport, food, other: otherFixed });
      // calculation_details makes the payslip reconcile with net_salary (bonus &
      // instructor earnings used to be folded into net invisibly).
      const calcDetails = JSON.stringify({
        instructorEarnings,
        instructorEarningsSource: 'approved_instructor_fees',
        instructorFeeCount: feeMap[emp.staff_id]?.count || 0,
        commissionSource, totalSalesEgp: Math.round(totalSales * 100) / 100,
        bonusTotal, deductionTotal, dedSocial, dedTax, unpaidLeaveDays, salaryCurrency, salaryFx,
        policyId: policy.id, policyVersion: policy.version,
      });
      await conn.query(`
        INSERT INTO payroll_items
          (payroll_run_id, staff_id, base_salary, allowances_json, total_allowances,
           commission, bonus, late_deductions, absence_deductions, advance_deductions,
           other_deductions, net_salary, attendance_days, absent_days, late_minutes,
           commission_count, calculation_details, tenant_id, branch_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
          commissionCount, calcDetails, tenantId, branchId]);
    }

    // Link consumed commissions to this run so they can't double-count next month
    // and get settled (→ PAID) when the run is paid.
    if (empIds.length) {
      await conn.query(
        `UPDATE crm_commissions SET status='INCLUDED_IN_PAYROLL', payroll_run_id=?
         WHERE staff_id IN (?) AND month=? AND year=? AND tenant_id=? AND status='PENDING'`,
        [runId, empIds, m, y, tenantId]
      );
      await conn.query(
        `UPDATE instructor_fees SET status='included_in_payroll',payroll_run_id=?
          WHERE tenant_id=? AND staff_id IN (?) AND period_month=? AND period_year=? AND status='approved'`,
        [runId, tenantId, empIds, m, y]
      );
    }

    // Update totals
    await conn.query(`
      UPDATE payroll_runs SET total_amount=?, employee_count=? WHERE id=? AND tenant_id=?
    `, [totalAmount, employees.length, runId, tenantId]);

    // Return run with items
    const [[updatedRun]] = await conn.query(
      `SELECT id, month, year, status, total_amount, employee_count, currency, notes,
              calculated_by, approved_by, paid_by, calculated_at, approved_at, paid_at, created_at
       FROM payroll_runs WHERE id=? AND tenant_id=?`, [runId, tenantId]
    );
    const [items] = await conn.query(`
      SELECT pi.*, s.name AS staff_name, s.name, s.role, s.image,
             pi.total_allowances AS allowances_total,
             pi.late_deductions AS late_deduction,
             pi.absence_deductions AS absence_deduction,
             pi.advance_deductions AS advance_deduction,
             pi.other_deductions AS other_deduction,
             pi.bonus AS bonus_amount,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pi.calculation_details, '$.instructorEarnings')), 0) AS instructor_earnings
      FROM payroll_items pi JOIN staff s ON s.id=pi.staff_id AND s.tenant_id=pi.tenant_id
      WHERE pi.payroll_run_id=? AND pi.tenant_id=?
      ORDER BY s.name
    `, [runId, tenantId]);

    await conn.commit();
    transactionStarted = false;
    res.json({ run: updatedRun, items });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/payroll]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// GET /api/admin/hr/payroll/:runId — get payroll run with items
router.get('/api/admin/hr/payroll/:runId', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const { runId } = req.params;
    const [[run]] = await pool.query(
      `SELECT id, month, year, status, total_amount, employee_count, currency, notes,
              calculated_by, approved_by, paid_by, calculated_at, approved_at, paid_at, created_at
       FROM payroll_runs WHERE id=? AND tenant_id=?`, [runId, req.tenantId]
    );
    if (!run) return res.status(404).json({ error: 'Not found' });
    const [items] = await pool.query(`
      SELECT pi.*, s.name AS staff_name, s.name, s.role, s.image, d.name AS department_name,
             pi.total_allowances AS allowances_total,
             pi.late_deductions AS late_deduction,
             pi.absence_deductions AS absence_deduction,
             pi.advance_deductions AS advance_deduction,
             pi.other_deductions AS other_deduction,
             pi.bonus AS bonus_amount,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pi.calculation_details, '$.instructorEarnings')),0) AS instructor_earnings
      FROM payroll_items pi
      JOIN staff s ON s.id=pi.staff_id AND s.tenant_id=pi.tenant_id
      LEFT JOIN hr_departments d ON d.id=s.department_id AND d.tenant_id=pi.tenant_id
       WHERE pi.payroll_run_id=? AND pi.tenant_id=?
      ORDER BY s.name
    `, [runId, req.tenantId]);
    res.json({ run, items });
  } catch (e) { logger.error('[hr/payroll]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/hr/payroll/:runId/status — approve/pay/cancel run
router.put('/api/admin/hr/payroll/:runId/status', requireAuth, requireAdminOrStaff, requireAnyPermission('manage_hr', 'manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { runId } = req.params;
    const { status } = req.body;
    const allowed = ['APPROVED','PAID','CANCELLED','CALCULATED'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const canManageHr = Boolean(req.isSuperAdmin || (req.staffRecord && hasPermission(req.staffRecord, 'manage_hr')));
    const canManageFinance = Boolean(req.isSuperAdmin || (req.staffRecord && hasPermission(req.staffRecord, 'manage_financial')));
    if (['APPROVED', 'PAID'].includes(status) && !canManageFinance) {
      return res.status(403).json({ error: 'اعتماد أو صرف الرواتب يتطلب صلاحية الإدارة المالية' });
    }
    if (['CANCELLED', 'CALCULATED'].includes(status) && !canManageHr && !canManageFinance) {
      return res.status(403).json({ error: 'غير مصرح بإدارة مسير الرواتب' });
    }
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    await conn.beginTransaction();
    transactionStarted = true;
    const [[prevRun]] = await conn.query(
      `SELECT id,month,year,status,total_amount,currency,calculated_by,approved_by
         FROM payroll_runs WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [runId, tenantId]
    );
    if (!prevRun) { await conn.rollback(); transactionStarted = false; return res.status(404).json({ error: 'Not found' }); }
    if (status === 'CANCELLED' && prevRun.status === 'APPROVED' && !canManageFinance) {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'إلغاء مسير معتمد يتطلب صلاحية الإدارة المالية' });
    }
    // Enforce the approval workflow: DRAFT/CALCULATED → APPROVED → PAID.
    // A run can never be paid without being approved first (Top20 #15).
    const transitions = {
      APPROVED:  ['DRAFT', 'CALCULATED'],
      PAID:      ['APPROVED'],
      CANCELLED: ['DRAFT', 'CALCULATED', 'APPROVED'],
      CALCULATED: ['CANCELLED'],
    };
    if (!transitions[status].includes(prevRun.status)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: `انتقال غير مسموح: ${prevRun.status} → ${status}. لا يمكن صرف الرواتب قبل اعتمادها.` });
    }
    const actorId = req.staffRecord?.id || req.user?.uid || null;
    if (!actorId) {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'تعذر تحديد منفذ إجراء الرواتب' });
    }
    if (status === 'APPROVED' && String(prevRun.calculated_by || '') === String(actorId)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'فصل المهام يمنع نفس الشخص من احتساب واعتماد مسير الرواتب', code: 'PAYROLL_SOD' });
    }
    if (status === 'PAID' && String(prevRun.approved_by || '') === String(actorId)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'فصل المهام يمنع نفس الشخص من اعتماد وصرف مسير الرواتب', code: 'PAYROLL_SOD' });
    }
    const colMap = { APPROVED: 'approved_by', PAID: 'paid_by', CANCELLED: null, CALCULATED: 'calculated_by' };
    const timeMap = { APPROVED: 'approved_at', PAID: 'paid_at', CANCELLED: null, CALCULATED: 'calculated_at' };
    let sql = `UPDATE payroll_runs SET status=?`;
    const params = [status];
    if (colMap[status]) { sql += `, ${colMap[status]}=?, ${timeMap[status]}=NOW()`; params.push(actorId); }
    if (status === 'CALCULATED') sql += ', approved_by=NULL, approved_at=NULL';
    sql += ` WHERE id=? AND tenant_id=?`; params.push(runId, tenantId);
    await conn.query(sql, params);

    // First transition to PAID: recognize earned payroll expense, cash settlement,
    // statutory withholdings and recovery of already-disbursed employee advances.
    if (status === 'PAID' && prevRun.status !== 'PAID') {
      const [[payrollTotals]] = await conn.query(
        `SELECT COALESCE(SUM(net_salary),0) net_total,
                COALESCE(SUM(advance_deductions),0) advance_total,
                COALESCE(SUM(
                  CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(calculation_details,'$.dedSocial')),'0') AS DECIMAL(14,2))
                  + CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(calculation_details,'$.dedTax')),'0') AS DECIMAL(14,2))
                ),0) statutory_total
           FROM payroll_items WHERE tenant_id=? AND payroll_run_id=?`,
        [tenantId, runId]
      );
      const netTotal = Number(payrollTotals?.net_total || 0);
      const advanceTotal = Number(payrollTotals?.advance_total || 0);
      const statutoryTotal = Number(payrollTotals?.statutory_total || 0);
      const earnedExpense = Number((netTotal + advanceTotal + statutoryTotal).toFixed(2));
      if (earnedExpense > 0) {
        const journalLines = [
          { account_code: '5100', account_name: 'تكلفة رواتب الموظفين', debit: earnedExpense, credit: 0 },
          { account_code: '1100', account_name: 'نقدية وبنوك', debit: 0, credit: netTotal },
        ];
        if (advanceTotal > 0) {
          journalLines.push({ account_code: '1300', account_name: 'سلف موظفين مدينة', debit: 0, credit: advanceTotal });
        }
        if (statutoryTotal > 0) {
          journalLines.push({ account_code: '2200', account_name: 'استقطاعات رواتب مستحقة', debit: 0, credit: statutoryTotal });
        }
        const journalId = await postJournalEntry('payroll', runId, new Date().toISOString().slice(0, 10),
          `رواتب شهر ${prevRun.month}/${prevRun.year} (= ${earnedExpense} EGP تكلفة)`,
          journalLines,
          req.user?.email || 'system', conn, tenantId
        );
        if (!journalId) throw new Error('Payroll journal posting failed');
      }
      await conn.query(
        "UPDATE crm_commissions SET status='PAID' WHERE payroll_run_id=? AND tenant_id=? AND status='INCLUDED_IN_PAYROLL'",
        [runId, tenantId]
      );
      await conn.query(
        "UPDATE instructor_fees SET status='paid',paid_by=?,paid_at=NOW() WHERE payroll_run_id=? AND tenant_id=? AND status='included_in_payroll'",
        [actorId, runId, tenantId]
      );
      await conn.query(
        `UPDATE salary_advances a
          JOIN payroll_items pi ON pi.staff_id=a.staff_id AND pi.tenant_id=a.tenant_id AND pi.payroll_run_id=?
           SET a.status='DEDUCTED',a.deducted_payroll_run_id=?
         WHERE a.tenant_id=? AND a.status='DISBURSED' AND a.deduct_month=? AND a.deduct_year=?`,
        [runId, runId, tenantId, prevRun.month, prevRun.year]
      );
    }
    if (status === 'CANCELLED') {
      await conn.query(
        "UPDATE crm_commissions SET status='PENDING',payroll_run_id=NULL WHERE payroll_run_id=? AND tenant_id=? AND status='INCLUDED_IN_PAYROLL'",
        [runId, tenantId]
      );
      await conn.query(
        "UPDATE instructor_fees SET status='approved',payroll_run_id=NULL WHERE payroll_run_id=? AND tenant_id=? AND status='included_in_payroll'",
        [runId, tenantId]
      );
    }
    await logFinancialAudit({
      entityType: 'payroll', entityId: runId, action: status.toLowerCase(),
      oldData: { status: prevRun.status }, newData: { status },
      amount: Number(prevRun.total_amount) || null,
      actor: req.user?.email || req.user?.name || 'admin', tenantId, db: conn, strict: true,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/payroll]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// PUT /api/admin/hr/payroll/items/:itemId — override payroll item
router.put('/api/admin/hr/payroll/items/:itemId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { itemId } = req.params;
    const { bonus, bonus_note, other_deductions, deductions_note } = req.body;
    // Recalculate net from stored values
    await conn.beginTransaction();
    transactionStarted = true;
    const [[item]] = await conn.query(
      `SELECT id, payroll_run_id, staff_id, base_salary, allowances_json, total_allowances,
              commission, bonus, bonus_note, late_deductions, absence_deductions, advance_deductions,
              other_deductions, deductions_note, net_salary, attendance_days, absent_days,
               late_minutes, commission_count, calculation_details, is_manual_override, override_by, created_at,
               tenant_id
       FROM payroll_items WHERE id=? AND tenant_id=? FOR UPDATE`, [itemId, req.tenantId]
    );
    if (!item) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Not found' });
    }
    if (String(item.staff_id) === String(req.staffRecord?.id || '')) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'لا يجوز تعديل بند راتبك بنفسك', code: 'HR_SELF_MUTATION' });
    }
    const [[run]] = await conn.query(
      'SELECT status FROM payroll_runs WHERE id=? AND tenant_id=? FOR UPDATE',
      [item.payroll_run_id, req.tenantId]
    );
    if (!run) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Payroll run not found' });
    }
    if (!['DRAFT', 'CALCULATED'].includes(run.status)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Approved or paid payroll cannot be edited' });
    }
    const parsedBonus = Number(bonus);
    const parsedDeductions = Number(other_deductions);
    const b = Number.isFinite(parsedBonus) ? Math.max(0, parsedBonus) : Number(item.bonus) || 0;
    const od = Number.isFinite(parsedDeductions) ? Math.max(0, parsedDeductions) : Number(item.other_deductions) || 0;
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
    await conn.query(`
      UPDATE payroll_items SET bonus=?, bonus_note=?, other_deductions=?, deductions_note=?,
        net_salary=?, is_manual_override=1, override_by=? WHERE id=? AND tenant_id=?
    `, [b, bonus_note || null, od, deductions_note || null, net, req.staffRecord?.id || null, itemId, req.tenantId]);
    // Recalculate run total
    const [[{ total }]] = await conn.query(
      'SELECT SUM(net_salary) AS total FROM payroll_items WHERE payroll_run_id=? AND tenant_id=?',
      [item.payroll_run_id, req.tenantId]
    );
    await conn.query('UPDATE payroll_runs SET total_amount=? WHERE id=? AND tenant_id=?', [total, item.payroll_run_id, req.tenantId]);
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, net_salary: net });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/payroll]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// ══════════════════════════════════════════════════════════════════════════════
// HR — ATTENDANCE IMPORT (CSV/text)
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/admin/hr/attendance/import — import attendance from CSV text
// Expects body: { csv: "...", month, year, filename }
// CSV format: employee_id OR name, date, check_in, check_out
router.post('/api/admin/hr/attendance/import', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { month, year, filename } = req.body;
    const csvText = req.body.csv ?? req.body.csvText;
    if (!csvText) return res.status(400).json({ error: 'No CSV data' });
    if (typeof csvText !== 'string' || csvText.length > 2_000_000) {
      return res.status(413).json({ error: 'CSV must be text and no larger than 2 MB' });
    }

    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();
    if (m < 1 || m > 12 || y < 2000 || y > 2100) {
      return res.status(400).json({ error: 'Invalid attendance month or year' });
    }

    // Create import batch
    const batchId = require('crypto').randomUUID();
    await conn.beginTransaction();
    transactionStarted = true;
    await conn.query(`
      INSERT INTO attendance_import_batches (id, tenant_id, filename, month, year, imported_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [batchId, req.tenantId, filename || 'import.csv', m, y, req.user?.uid || null]);

    // Parse CSV
    const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2 || lines.length > 20_001) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(400).json({ error: 'CSV must contain a header and at most 20,000 data rows' });
    }
    let headers;
    try {
      headers = parseCsvRow(lines[0]).map(h => h.toLowerCase());
    } catch (error) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(400).json({ error: error.message });
    }

    const idxStaff    = headers.findIndex(h => h.includes('id') || h.includes('name') || h.includes('موظف') || h.includes('employee'));
    const idxDate     = headers.findIndex(h => h.includes('date') || h.includes('تاريخ'));
    const idxCheckIn  = headers.findIndex(h => h.includes('in') || h.includes('دخول') || h.includes('check_in'));
    const idxCheckOut = headers.findIndex(h => h.includes('out') || h.includes('خروج') || h.includes('check_out'));

    if (idxStaff < 0 || idxDate < 0) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(400).json({ error: 'CSV must have employee and date columns', headers });
    }

    // Get all staff for name matching
    const [allStaff] = await conn.query(
      'SELECT id, name FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL',
      [req.tenantId]
    );
    const staffByName = new Map();
    const staffById   = {};
    allStaff.forEach(s => {
      const normalized = s.name.toLowerCase().trim();
      const matches = staffByName.get(normalized) || [];
      matches.push(s.id);
      staffByName.set(normalized, matches);
      staffById[s.id] = s.id;
    });
    const [scheduleRows] = await conn.query(
      `SELECT staff_id,day_of_week,start_time,grace_minutes,is_off_day
         FROM work_schedules WHERE tenant_id=?`,
      [req.tenantId]
    );
    const schedules = new Map(scheduleRows.map(row => [`${row.staff_id}:${row.day_of_week}`, row]));
    const policy = await getEffectiveHrPolicy(conn, req.tenantId, `${y}-${String(m).padStart(2, '0')}-01`);
    const monthPrefix = `${y}-${String(m).padStart(2, '0')}`;
    const monthStart = `${monthPrefix}-01`;
    const monthEnd = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const [lockedRows] = await conn.query(
      `SELECT staff_id,DATE_FORMAT(date,'%Y-%m-%d') date,leave_id
         FROM attendance_logs
        WHERE tenant_id=? AND date>=? AND date<? FOR UPDATE`,
      [req.tenantId, monthStart, monthEnd]
    );
    const lockedAttendance = new Map(lockedRows.map(row => [`${row.staff_id}:${row.date}`, row]));

    let imported = 0, skipped = 0;
    const errors = [];
    const addError = message => { if (errors.length < 200) errors.push(message); };
    for (let i = 1; i < lines.length; i++) {
      let cols;
      try {
        cols = parseCsvRow(lines[i]);
      } catch (error) {
        skipped++; addError(`Row ${i + 1}: ${error.message}`); continue;
      }
      if (cols.length < 2) continue;

      const staffRaw = cols[idxStaff] || '';
      const dateRaw  = cols[idxDate]  || '';

      // Resolve staff id
      const normalizedName = staffRaw.toLowerCase().trim();
      const exactMatches = staffByName.get(normalizedName) || [];
      let staffId = staffById[staffRaw] || (exactMatches.length === 1 ? exactMatches[0] : null);
      if (!staffId) {
        const partialMatches = [...staffByName.entries()]
          .filter(([name]) => name.includes(normalizedName) || normalizedName.includes(name))
          .flatMap(([, ids]) => ids);
        if (partialMatches.length === 1) staffId = partialMatches[0];
      }
      if (!staffId) { skipped++; addError(`Row ${i + 1}: staff "${staffRaw}" not found or ambiguous`); continue; }

      // Parse date — try DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY
      let dateObj;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
        dateObj = new Date(`${dateRaw}T12:00:00Z`);
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateRaw)) {
        const [d, mon, yr] = dateRaw.split('/');
        dateObj = new Date(`${yr}-${String(mon).padStart(2,'0')}-${String(d).padStart(2,'0')}T12:00:00Z`);
      } else { skipped++; addError(`Row ${i + 1}: invalid date "${dateRaw}"`); continue; }

      if (!dateObj || Number.isNaN(dateObj.getTime())) {
        skipped++; addError(`Row ${i + 1}: invalid date "${dateRaw}"`); continue;
      }
      const dateStr = dateObj.toISOString().split('T')[0];
      const checkIn  = idxCheckIn  >= 0 ? (cols[idxCheckIn]  || null) : null;
      const checkOut = idxCheckOut >= 0 ? (cols[idxCheckOut] || null) : null;
      if (!dateStr.startsWith(monthPrefix)) {
        skipped++; addError(`Row ${i + 1}: date must be inside ${monthPrefix}`); continue;
      }
      if (!validClockTime(checkIn) || !validClockTime(checkOut)) {
        skipped++; addError(`Row ${i + 1}: time must use HH:mm`); continue;
      }
      if (lockedAttendance.get(`${staffId}:${dateStr}`)?.leave_id) {
        skipped++; addError(`Row ${i + 1}: approved leave attendance is locked`); continue;
      }

      // Calculate late_minutes and total_hours
      let lateMins = 0, totalHours = null;
      if (checkIn) {
        const day = dateObj.getUTCDay();
        const schedule = schedules.get(`${staffId}:${day}`);
        if (schedule?.is_off_day) {
          skipped++; addError(`Row ${i + 1}: scheduled off-day`); continue;
        }
        const expectedStart = schedule
          ? clockMinutes(schedule.start_time) + Number(schedule.grace_minutes || 0)
          : 9 * 60 + Number(policy.grace_minutes || 0);
        const actualStart = clockMinutes(checkIn);
        if (actualStart > expectedStart) lateMins = actualStart - expectedStart;
      }
      if (checkIn && checkOut) {
        const durationMinutes = clockMinutes(checkOut) - clockMinutes(checkIn);
        if (durationMinutes < 0) {
          skipped++; addError(`Row ${i + 1}: check_out precedes check_in`); continue;
        }
        totalHours = Math.round((durationMinutes / 60) * 100) / 100;
      }

      const status = !checkIn ? 'ABSENT' : lateMins > 0 ? 'LATE' : 'PRESENT';

      await conn.query(`
        INSERT INTO attendance_logs
          (tenant_id, staff_id, date, check_in, check_out, total_hours, late_minutes, status, source, import_batch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FINGERPRINT_IMPORT', ?)
        ON DUPLICATE KEY UPDATE
          check_in=VALUES(check_in), check_out=VALUES(check_out),
          total_hours=VALUES(total_hours), late_minutes=VALUES(late_minutes),
          status=VALUES(status), import_batch_id=VALUES(import_batch_id)
      `, [req.tenantId, staffId, dateStr, checkIn || null, checkOut || null, totalHours, lateMins, status, batchId]);
      imported++;
    }

    await conn.query(`
      UPDATE attendance_import_batches SET rows_ok=?, rows_error=?
      WHERE tenant_id=? AND id=?
    `, [imported, skipped, req.tenantId, batchId]);

    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, imported, skipped, errors: errors.slice(0, 20) });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/payroll]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// GET /api/admin/hr/attendance/summary — monthly attendance summary for all staff
router.get('/api/admin/hr/attendance/summary', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
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
      LEFT JOIN hr_departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id
      LEFT JOIN attendance_logs a ON a.staff_id=s.id AND a.tenant_id=s.tenant_id AND MONTH(a.date)=? AND YEAR(a.date)=?
      WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL
      GROUP BY s.id ORDER BY s.name
    `, [m, y, req.tenantId]);
    res.json(rows);
  } catch (e) { logger.error('[hr/payroll]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v14 — Recruitment
// ══════════════════════════════════════════════════════════════

// List all job postings
module.exports = router;
