'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');
const { createLeaveRequest, getEffectiveHrPolicy } = require('../../lib/hrPolicy');
const { writeAuditEvent } = require('../../lib/auditTrail');

router.get('/api/admin/hr/compensation/pending', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [salaries, adjustments, fees, rates] = await Promise.all([
      pool.query(
        `SELECT ss.id,ss.staff_id,s.name AS staff_name,ss.base_salary AS amount,ss.currency,
                ss.effective_from,ss.created_at,c.name AS created_by_name
           FROM salary_structures ss
           JOIN staff s ON s.id=ss.staff_id AND s.tenant_id=ss.tenant_id
           LEFT JOIN staff c ON c.id=ss.created_by AND c.tenant_id=ss.tenant_id
          WHERE ss.tenant_id=? AND ss.status='PENDING' ORDER BY ss.created_at`,
        [req.tenantId]
      ),
      pool.query(
        `SELECT b.id,b.staff_id,s.name AS staff_name,b.type,b.amount,b.currency,b.reason,
                b.for_month,b.for_year,b.created_at,c.name AS created_by_name
           FROM employee_bonuses b
           JOIN staff s ON s.id=b.staff_id AND s.tenant_id=b.tenant_id
           LEFT JOIN staff c ON c.id=b.created_by AND c.tenant_id=b.tenant_id
          WHERE b.tenant_id=? AND b.status='PENDING' ORDER BY b.created_at`,
        [req.tenantId]
      ),
      pool.query(
        `SELECT f.id,f.staff_id,s.name AS staff_name,f.fee_type,f.total_amount AS amount,
                f.currency,f.period_month,f.period_year,f.note,f.created_at,c.name AS created_by_name
           FROM instructor_fees f
           JOIN staff s ON s.id=f.staff_id AND s.tenant_id=f.tenant_id
           LEFT JOIN staff c ON c.id=f.created_by AND c.tenant_id=f.tenant_id
          WHERE f.tenant_id=? AND f.status='pending' ORDER BY f.created_at`,
        [req.tenantId]
      ),
      pool.query(
        `SELECT r.id,r.staff_id,s.name AS staff_name,r.lecture_rate_per_hour AS amount,
                r.currency,r.created_at,c.name AS created_by_name
           FROM instructor_rate_change_requests r
           JOIN staff s ON s.id=r.staff_id AND s.tenant_id=r.tenant_id
           LEFT JOIN staff c ON c.id=r.requested_by AND c.tenant_id=r.tenant_id
          WHERE r.tenant_id=? AND r.status='PENDING' ORDER BY r.created_at`,
        [req.tenantId]
      ),
    ]);
    res.json({ salaries: salaries[0], adjustments: adjustments[0], fees: fees[0], rates: rates[0] });
  } catch (error) {
    logger.error('[hr/compensation/pending]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    if (req.staffRecord?.id === req.params.staffId) {
      return res.status(409).json({ error: 'لا يجوز تعديل أجر التدريب الخاص بك', code: 'HR_SELF_MUTATION' });
    }
    const { consultation_rate_type, consultation_rate_value, lecture_rate_per_hour, training_rate_per_hour, currency, notes } = req.body;
    const rateType = consultation_rate_type || 'per_session';
    const normalizedCurrency = String(currency || 'EGP').toUpperCase();
    const amounts = [consultation_rate_value, lecture_rate_per_hour, training_rate_per_hour].map(value => Number(value || 0));
    if (!['per_session', 'percentage', 'per_hour'].includes(rateType)
        || !['EGP', 'SAR', 'USD'].includes(normalizedCurrency)
        || amounts.some(value => !Number.isFinite(value) || value < 0 || value > 10000000)
        || (rateType === 'percentage' && amounts[0] > 100)) {
      return res.status(400).json({ error: 'Invalid instructor rate values' });
    }
    await conn.beginTransaction(); transactionStarted = true;
    const [[ownedStaff]] = await conn.query(
      'SELECT id FROM staff WHERE tenant_id=? AND id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [req.tenantId, req.params.staffId]
    );
    if (!ownedStaff) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Staff record not found' });
    }
    const [[pending]] = await conn.query(
      `SELECT id FROM instructor_rate_change_requests
        WHERE tenant_id=? AND staff_id=? AND status='PENDING' LIMIT 1 FOR UPDATE`,
      [req.tenantId, req.params.staffId]
    );
    if (pending) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'A rate change is already pending', code: 'RATE_CHANGE_PENDING' });
    }
    const id = uuidv4();
    await conn.query(
      `INSERT INTO instructor_rate_change_requests
        (id,tenant_id,staff_id,consultation_rate_type,consultation_rate_value,
         lecture_rate_per_hour,training_rate_per_hour,currency,notes,requested_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, req.params.staffId, rateType, ...amounts, normalizedCurrency,
        notes ? String(notes).slice(0, 5000) : null, req.staffRecord?.id || null]
    );
    await writeAuditEvent({
      action: 'hr.instructor_rate.requested', entityType: 'instructor_rate_change', entityId: id,
      severity: 'warning', metadata: { staff_id: req.params.staffId, currency: normalizedCurrency },
      req, db: conn,
    });
    await conn.commit(); transactionStarted = false;
    res.json({ ok: true, id, status: 'PENDING' });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/instructor-rates/request]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

router.put('/api/admin/hr/instructor-rate-proposals/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const status = String(req.body?.status || '').toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await conn.beginTransaction(); transactionStarted = true;
    const [[proposal]] = await conn.query(
      `SELECT * FROM instructor_rate_change_requests
        WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id, req.tenantId]
    );
    if (!proposal) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Rate proposal not found' });
    }
    if (proposal.status !== 'PENDING') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Rate proposal already reviewed' });
    }
    const actorId = req.staffRecord?.id || req.user?.uid || null;
    if (!actorId || String(actorId) === String(proposal.requested_by || '')) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Rate proposal requires a separate reviewer', code: 'RATE_SOD' });
    }
    if (status === 'APPROVED') {
      await conn.query(
        `INSERT INTO instructor_rates
          (id,tenant_id,staff_id,consultation_rate_type,consultation_rate_value,
           lecture_rate_per_hour,training_rate_per_hour,currency,notes)
         VALUES (UUID(),?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           consultation_rate_type=VALUES(consultation_rate_type),
           consultation_rate_value=VALUES(consultation_rate_value),
           lecture_rate_per_hour=VALUES(lecture_rate_per_hour),
           training_rate_per_hour=VALUES(training_rate_per_hour),
           currency=VALUES(currency),notes=VALUES(notes),updated_at=NOW()`,
        [req.tenantId, proposal.staff_id, proposal.consultation_rate_type, proposal.consultation_rate_value,
          proposal.lecture_rate_per_hour, proposal.training_rate_per_hour, proposal.currency, proposal.notes]
      );
    }
    await conn.query(
      `UPDATE instructor_rate_change_requests
          SET status=?,reviewed_by=?,reviewed_at=NOW() WHERE id=? AND tenant_id=?`,
      [status, actorId, proposal.id, req.tenantId]
    );
    await writeAuditEvent({
      action: `hr.instructor_rate.${status.toLowerCase()}`,
      entityType: 'instructor_rate_change', entityId: proposal.id,
      severity: status === 'APPROVED' ? 'critical' : 'warning',
      metadata: { staff_id: proposal.staff_id }, req, db: conn,
    });
    await conn.commit(); transactionStarted = false;
    res.json({ ok: true, status });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/instructor-rates/review]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
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
    if (req.staffRecord?.id === req.params.staffId) {
      return res.status(409).json({ error: 'لا يجوز إضافة مكافأة أو خصم لنفسك', code: 'HR_SELF_MUTATION' });
    }
    if (!['bonus', 'deduction'].includes(type || 'bonus') || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Invalid bonus or deduction values' });
    }
    const id = uuidv4();
    const [created] = await pool.query(
      `INSERT INTO employee_bonuses
        (id,tenant_id,staff_id,type,amount,currency,reason,for_month,for_year,created_by,status)
       SELECT ?,?,?,?,?,?,?,?,?,?,'PENDING'
       FROM staff WHERE tenant_id=? AND id=? AND deleted_at IS NULL`,
      [id, req.tenantId, req.params.staffId, type||'bonus', amount, currency||'EGP', reason||null, for_month||null, for_year||null, req.staffRecord?.id||null,
       req.tenantId, req.params.staffId]
    );
    if (!created.affectedRows) return res.status(404).json({ error: 'Staff record not found' });
    const [[row]] = await pool.query(
      `SELECT id,staff_id,type,amount,status,currency,reason,for_month,for_year,created_by,created_at
       FROM employee_bonuses WHERE tenant_id=? AND id=?`, [req.tenantId, id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/hr/bonuses/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { status } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await conn.beginTransaction();
    transactionStarted = true;
    const [[bonus]] = await conn.query(
      `SELECT id,staff_id,status,created_by FROM employee_bonuses
        WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE`,
      [req.tenantId, req.params.id]
    );
    if (!bonus) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Bonus record not found' });
    }
    if (bonus.status !== 'PENDING') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Only pending adjustments can be reviewed' });
    }
    const actor = req.staffRecord?.id || req.user?.uid || null;
    if (!actor || [bonus.staff_id, bonus.created_by].map(String).includes(String(actor))) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'فصل المهام يمنع صاحب البند أو منشئه من اعتماده', code: 'BONUS_SOD' });
    }
    await conn.query(
      'UPDATE employee_bonuses SET status=?,approved_by=?,approved_at=NOW() WHERE tenant_id=? AND id=?',
      [status, actor, req.tenantId, bonus.id]
    );
    await writeAuditEvent({
      action: `hr.compensation_adjustment.${status.toLowerCase()}`,
      entityType: 'employee_bonus',
      entityId: bonus.id,
      severity: 'critical',
      metadata: { staff_id: bonus.staff_id },
      req,
      db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, status });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/bonuses/status]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

router.delete('/api/admin/hr/bonuses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [deleted] = await pool.query(
      "DELETE FROM employee_bonuses WHERE tenant_id=? AND id=? AND staff_id<>? AND status='PENDING'",
      [req.tenantId, req.params.id, req.staffRecord?.id || '']
    );
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
    if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ error: 'Positive fee total required' });
    if (req.staffRecord?.id === staff_id) {
      return res.status(409).json({ error: 'لا يجوز إنشاء أجر تدريب لنفسك', code: 'HR_SELF_MUTATION' });
    }
    const id = uuidv4();
    const [created] = await pool.query(
      `INSERT INTO instructor_fees (id, tenant_id, staff_id, course_id, daqqi_round_id, fee_type, hours, rate_per_hour, fixed_amount, total_amount, currency, period_month, period_year, note, created_by)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
       FROM staff s
       WHERE s.tenant_id=? AND s.id=? AND s.deleted_at IS NULL
         AND (? IS NULL OR EXISTS (SELECT 1 FROM courses c WHERE c.tenant_id=? AND c.id=?))`,
      [id, req.tenantId, staff_id, course_id||null, daqqi_round_id||null, fee_type||'lecture',
       hours||null, rate_per_hour||null, fixed_amount||null, total,
       currency||'EGP', period_month||null, period_year||null, note||null, req.staffRecord?.id || req.user?.uid || null,
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
    if (status === 'paid') {
      return res.status(409).json({
        error: 'Instructor fees are paid only through an approved payroll run',
        code: 'PAYROLL_SETTLEMENT_REQUIRED',
      });
    }
    const allowed = ['pending','approved','rejected'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    await conn.beginTransaction();
    const [[current]] = await conn.query(
      `SELECT id,staff_id,status,created_by,approved_by FROM instructor_fees
       WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE`,
      [req.tenantId, req.params.id]
    );
    if (!current) {
      await conn.rollback();
      return res.status(404).json({ error: 'Instructor fee not found' });
    }
    if (status && status !== current.status) {
      const transitions = { pending: ['approved', 'rejected'], approved: [], rejected: [], included_in_payroll: [], paid: [] };
      if (!transitions[String(current.status).toLowerCase()]?.includes(status)) {
        await conn.rollback();
        return res.status(409).json({ error: `Invalid fee transition: ${current.status} -> ${status}` });
      }
      const actor = req.staffRecord?.id || req.user?.uid || null;
      if (!actor
        || (['approved', 'rejected'].includes(status) && [current.staff_id, current.created_by].map(String).includes(String(actor)))) {
        await conn.rollback();
        return res.status(409).json({ error: 'فصل المهام يمنع تنفيذ هذه الخطوة بواسطة نفس الشخص', code: 'INSTRUCTOR_FEE_SOD' });
      }
    }
    const sets = [];
    const params = [];
    if (status) {
      sets.push('status=?'); params.push(status);
      const actor = req.staffRecord?.id || req.user?.uid || null;
      if (status === 'approved') { sets.push('approved_by=?', 'approved_at=NOW()'); params.push(actor); }
    }
    if (note !== undefined) { sets.push('note=?'); params.push(note); }
    if (!sets.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'nothing to update' });
    }
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
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    await conn.beginTransaction();
    transactionStarted = true;
    const [[fee]] = await conn.query(
      'SELECT id,staff_id,status FROM instructor_fees WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE',
      [req.tenantId, req.params.id]
    );
    if (!fee) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Instructor fee not found' });
    }
    if (String(fee.status).toLowerCase() !== 'pending') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({
        error: 'Only pending instructor fees can be deleted; reviewed records are immutable',
        code: 'INSTRUCTOR_FEE_IMMUTABLE',
      });
    }
    await writeAuditEvent({
      action: 'hr.instructor_fee.deleted',
      entityType: 'instructor_fee',
      entityId: fee.id,
      severity: 'warning',
      metadata: { staff_id: fee.staff_id },
      req,
      db: conn,
    });
    await conn.query('DELETE FROM instructor_fees WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
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

// Self-service leave list/submit. Writes to the SAME `leaves` table the admin HR
// approval workflow (routes/hr/attendance.js) reads/approves from — this used to write
// to a separate `leave_requests` table that no approval screen ever looked at, so a
// self-submitted request could never actually be approved (HR-02).
router.get('/api/staff/me/leaves', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(403).json({ error: 'Staff record not found' });
    const [rows] = await pool.query(
      `SELECT l.id, l.type, l.start_date, l.end_date, l.total_days, l.reason, l.status, l.created_at,
              a.name AS approved_by_name
       FROM leaves l
       LEFT JOIN staff a ON a.id=l.approved_by AND a.tenant_id=l.tenant_id
       WHERE l.tenant_id=? AND l.staff_id=? ORDER BY l.created_at DESC LIMIT 50`,
      [req.tenantId, staff.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/staff/me/leaves', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(403).json({ error: 'Staff record not found' });
    const { type, start_date, end_date, reason } = req.body;
    if (!type || !start_date || !end_date) {
      return res.status(400).json({ error: 'type, start_date, end_date required' });
    }
    const { policy, totalDays } = await createLeaveRequest(pool, {
      tenantId: req.tenantId, staffId: staff.id, type,
      startDate: start_date, endDate: end_date, reason,
    });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO leaves
        (id,tenant_id,policy_id,staff_id,type,start_date,end_date,total_days,reason,status)
       VALUES (?,?,?,?,?,?,?,?,?,'PENDING')`,
      [id, req.tenantId, policy.id, staff.id, type, start_date, end_date, totalDays, reason || null]
    );
    await createNotification('info', 'طلب إجازة جديد',
      `موظف طلب ${type === 'PERMISSION' ? 'إذن' : 'إجازة'} من ${start_date} إلى ${end_date}`,
      { leave_id: id, staff_id: staff.id }, req.tenantId
    );
    const [[row]] = await pool.query(
      'SELECT id, staff_id, type, start_date, end_date, total_days, reason, status FROM leaves WHERE tenant_id=? AND id=?',
      [req.tenantId, id]
    );
    res.json(row);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' });
  }
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

router.get('/api/admin/hr/appraisals', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    let sql = `SELECT p.id,p.staff_id,s.name AS staff_name,p.reviewer_email,p.reviewer_id,
                      p.period_month,p.period_year,p.kpi_scores,p.evidence_json,p.overall_score,
                      p.grade,p.notes,p.status,p.submitted_at,p.approved_by,p.approved_at,p.created_at
                 FROM performance_appraisals p
                 JOIN staff s ON s.id=p.staff_id AND s.tenant_id=p.tenant_id
                WHERE p.tenant_id=?`;
    const params = [req.tenantId];
    if (req.query.staff_id) { sql += ' AND p.staff_id=?'; params.push(req.query.staff_id); }
    if (req.query.status) { sql += ' AND p.status=?'; params.push(req.query.status); }
    sql += ' ORDER BY p.period_year DESC,p.period_month DESC,p.created_at DESC LIMIT 300';
    const [rows] = await pool.query(sql, params);
    res.json(rows.map(row => ({
      ...row,
      kpi_scores: tryJson(row.kpi_scores, []),
      evidence_json: tryJson(row.evidence_json, []),
    })));
  } catch (error) {
    logger.error('[hr/appraisals]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/hr/appraisals', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { staff_id, period_month, period_year, kpi_scores, evidence_json, notes } = req.body;
    const scores = Array.isArray(kpi_scores) ? kpi_scores.slice(0, 20) : [];
    const evidence = Array.isArray(evidence_json) ? evidence_json.slice(0, 20) : [];
    const month = Number(period_month);
    const year = Number(period_year);
    if (!staff_id || month < 1 || month > 12 || year < 2000 || year > 2100 || !scores.length) {
      return res.status(400).json({ error: 'Valid staff, period and KPI scores are required' });
    }
    if (req.staffRecord?.id === staff_id) {
      return res.status(409).json({ error: 'لا يجوز إنشاء تقييم لنفسك', code: 'APPRAISAL_SELF_REVIEW' });
    }
    const normalizedScores = scores.map(item => ({
      kpi: String(item?.kpi || '').slice(0, 120),
      target: Number(item?.target || 0),
      achieved: Number(item?.achieved || 0),
      score: Math.min(100, Math.max(0, Number(item?.score || 0))),
    })).filter(item => item.kpi);
    if (!normalizedScores.length) return res.status(400).json({ error: 'At least one named KPI is required' });
    const normalizedEvidence = evidence.map(item => ({
      label: String(item?.label || '').slice(0, 160),
      url: String(item?.url || '').slice(0, 1000),
      source_type: String(item?.source_type || '').slice(0, 80),
      source_id: String(item?.source_id || '').slice(0, 120),
    })).filter(item => item.label && (item.url || item.source_id));
    const overall = normalizedScores.reduce((total, item) => total + item.score, 0) / normalizedScores.length;
    const grade = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : overall >= 60 ? 'D' : 'F';
    const [[staff]] = await pool.query(
      'SELECT id FROM staff WHERE tenant_id=? AND id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1',
      [req.tenantId, staff_id]
    );
    if (!staff) return res.status(404).json({ error: 'Active staff record not found' });
    const [[existing]] = await pool.query(
      'SELECT id FROM performance_appraisals WHERE tenant_id=? AND staff_id=? AND period_month=? AND period_year=? LIMIT 1',
      [req.tenantId, staff_id, month, year]
    );
    if (existing) return res.status(409).json({ error: 'An appraisal already exists for this period' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO performance_appraisals
        (id,tenant_id,staff_id,reviewer_email,reviewer_id,period_month,period_year,
         kpi_scores,evidence_json,overall_score,grade,notes,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'draft')`,
      [id, req.tenantId, staff_id, req.user?.email || null,
        req.staffRecord?.id || req.user?.uid || null, month, year, JSON.stringify(normalizedScores),
        JSON.stringify(normalizedEvidence), overall.toFixed(2), grade, notes || null]
    );
    res.json({ ok: true, id, status: 'draft', overall_score: overall, grade });
  } catch (error) {
    logger.error('[hr/appraisals/create]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/hr/appraisals/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { status } = req.body;
    if (!['submitted', 'approved'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await conn.beginTransaction();
    transactionStarted = true;
    const [[appraisal]] = await conn.query(
      `SELECT id,staff_id,reviewer_id,status,evidence_json FROM performance_appraisals
        WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE`,
      [req.tenantId, req.params.id]
    );
    if (!appraisal) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Appraisal not found' });
    }
    const transitions = { draft: ['submitted'], submitted: ['approved'] };
    if (!transitions[appraisal.status]?.includes(status)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: `Invalid appraisal transition: ${appraisal.status} → ${status}` });
    }
    const actor = req.staffRecord?.id || req.user?.uid || null;
    if (status === 'submitted' && String(actor) !== String(appraisal.reviewer_id)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'Only the reviewer can submit this appraisal' });
    }
    if (status === 'submitted' && !tryJson(appraisal.evidence_json, []).length) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Evidence is required before appraisal submission' });
    }
    if (status === 'approved' && [appraisal.staff_id, appraisal.reviewer_id].map(String).includes(String(actor))) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'فصل المهام يمنع الموظف أو المراجع من اعتماد التقييم', code: 'APPRAISAL_SOD' });
    }
    const sql = status === 'submitted'
      ? "UPDATE performance_appraisals SET status='submitted',submitted_at=NOW() WHERE tenant_id=? AND id=?"
      : "UPDATE performance_appraisals SET status='approved',approved_by=?,approved_at=NOW() WHERE tenant_id=? AND id=?";
    await conn.query(sql, status === 'submitted'
      ? [req.tenantId, appraisal.id]
      : [actor, req.tenantId, appraisal.id]);
    await writeAuditEvent({
      action: `hr.appraisal.${status}`,
      entityType: 'performance_appraisal',
      entityId: appraisal.id,
      severity: 'warning',
      metadata: { staff_id: appraisal.staff_id },
      req,
      db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, status });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/appraisals/status]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

router.get('/api/staff/me/appraisals', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(403).json({ error: 'Not a staff member' });
    const [rows] = await pool.query(
      `SELECT id,staff_id,reviewer_email,period_month,period_year,kpi_scores,evidence_json,overall_score,
              grade, notes, status, created_at, updated_at
       FROM performance_appraisals
       WHERE tenant_id=? AND staff_id=? AND status IN ('submitted','approved')
       ORDER BY period_year DESC, period_month DESC`,
      [req.tenantId, staff.id]
    );
    res.json(rows.map(r => ({
      ...r,
      kpi_scores: tryJson(r.kpi_scores, []),
      evidence_json: tryJson(r.evidence_json, []),
    })));
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
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    if (!/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: 'month must use YYYY-MM' });
    }
    const [y, m] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const monthEnd   = new Date(y, m, 1).toISOString().slice(0, 10); // first day of next month

    // All active staff
    const [staff] = await pool.query(
      `SELECT id, name, email, role, employment_type
       FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL ORDER BY name ASC`,
      [req.tenantId]
    );

    // One canonical source: real attendance rows, including leave-linked rows.
    const [attendance] = await pool.query(
      `SELECT a.staff_id,
              SUM(a.status IN ('PRESENT','LATE','REMOTE')) AS present_days,
              SUM(a.status='HALF_DAY') * 0.5 AS half_days_present,
              SUM(a.status='ABSENT') AS absence_days,
              SUM(a.status='LATE') AS late_days,
              SUM(CASE WHEN a.leave_id IS NOT NULL AND l.type='SICK'
                       THEN IF(a.status='HALF_DAY',0.5,1) ELSE 0 END) AS sick_days,
              SUM(CASE WHEN a.leave_id IS NOT NULL AND l.type<>'SICK'
                       THEN IF(a.status='HALF_DAY',0.5,1) ELSE 0 END) AS leave_days
         FROM attendance_logs a
         LEFT JOIN leaves l ON l.tenant_id=a.tenant_id AND l.id=a.leave_id
        WHERE a.tenant_id=? AND a.date>=? AND a.date<?
        GROUP BY a.staff_id`,
      [req.tenantId, monthStart, monthEnd]
    );
    const attendanceByStaff = new Map(attendance.map(row => [row.staff_id, row]));

    const policy = await getEffectiveHrPolicy(pool, req.tenantId, monthStart);
    const weekend = new Set(policy.weekend_days_json || [5, 6]);
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDow    = new Date(y, m - 1, 1).getDay(); // 0=Sun
    let workDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = (firstDow + d - 1) % 7;
      if (!weekend.has(dow)) workDays++;
    }

    const report = staff.map(s => {
      const row = attendanceByStaff.get(s.id) || {};
      const absenceDays = Number(row.absence_days || 0);
      const sickDays = Number(row.sick_days || 0);
      const lateDays = Number(row.late_days || 0);
      const leaveDays = Number(row.leave_days || 0);
      const presentDays = Number(row.present_days || 0) + Number(row.half_days_present || 0);
      const expectedDays = Math.max(0, workDays - sickDays - leaveDays);
      const attendancePct = expectedDays > 0
        ? Math.min(100, Math.round((presentDays / expectedDays) * 100))
        : 100;
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
