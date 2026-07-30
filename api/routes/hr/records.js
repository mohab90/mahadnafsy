'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');
const { writeAuditEvent } = require('../../lib/auditTrail');
const { financialRecordMatches, resolveFinancialScope } = require('../../lib/financialScope');
const { dateOnlyInTimeZone } = require('../../lib/dates');

const CURRENCIES = new Set(['EGP', 'SAR', 'USD']);
const DISCIPLINARY_TYPES = new Set(['warning', 'verbal_warning', 'written_warning', 'suspension', 'termination', 'other']);
const DISCIPLINARY_SEVERITIES = new Set(['low', 'medium', 'high']);
const DOCUMENT_CATEGORIES = new Set(['contract', 'id', 'certificate', 'medical', 'other']);
const validMoney = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 100000000;
const validPeriod = (month, year) => Number.isInteger(Number(month))
  && Number(month) >= 1 && Number(month) <= 12
  && Number.isInteger(Number(year)) && Number(year) >= 2020 && Number(year) <= 2100;
const validDate = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value));
const cleanCurrency = value => String(value || 'EGP').trim().toUpperCase();
const cleanText = (value, max) => value == null || value === '' ? null : String(value).trim().slice(0, max);
const safeDocumentUrl = value => {
  if (!value) return null;
  const url = String(value).trim();
  return (/^https:\/\//i.test(url) || /^\/uploads\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(url)) ? url : false;
};

router.get('/api/admin/hr/advances', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const { staff_id, status } = req.query;
    let sql = `SELECT a.*, s.name AS staff_name, s.role, s.image,
        ap.name AS approved_by_name
      FROM salary_advances a
      JOIN staff s ON s.id=a.staff_id AND s.tenant_id=a.tenant_id
      LEFT JOIN staff ap ON ap.id=a.approved_by AND ap.tenant_id=a.tenant_id
      WHERE a.tenant_id=?`;
    const params = [req.tenantId];
    if (staff_id) { sql += ' AND a.staff_id=?'; params.push(staff_id); }
    if (status)   { sql += ' AND a.status=?';   params.push(status); }
    sql += ' ORDER BY a.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Request an advance (any staff for themselves, admin for anyone)
router.post('/api/admin/hr/advances', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { staff_id, amount, currency, reason, deduct_month, deduct_year } = req.body;
    const normalizedCurrency = cleanCurrency(currency);
    if (!staff_id || !validMoney(amount)) {
      return res.status(400).json({ error: 'staff_id and positive valid amount required' });
    }
    if (!CURRENCIES.has(normalizedCurrency)) return res.status(400).json({ error: 'Unsupported currency' });
    if ((deduct_month != null || deduct_year != null) && !validPeriod(deduct_month, deduct_year)) {
      return res.status(400).json({ error: 'Valid deduction month and year are required together' });
    }
    const id = uuidv4();
    await conn.beginTransaction();
    transactionStarted = true;
    const [created] = await conn.query(
      `INSERT INTO salary_advances
        (id, tenant_id, staff_id, amount, currency, reason, requested_by, deduct_month, deduct_year)
       SELECT ?,?,?,?,?,?,?,?,?
        WHERE EXISTS (
          SELECT 1 FROM staff WHERE id=? AND tenant_id=? AND is_active=1 AND deleted_at IS NULL
        )`,
      [id, req.tenantId, staff_id, Number(amount), normalizedCurrency, cleanText(reason, 2000),
        req.staffRecord?.id || null, deduct_month || null, deduct_year || null, staff_id, req.tenantId]
    );
    if (!created.affectedRows) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Active employee not found' });
    }
    await writeAuditEvent({
      action: 'hr.advance.requested',
      entityType: 'salary_advance',
      entityId: id,
      metadata: { staff_id, amount: Number(amount), currency: normalizedCurrency },
      req,
      db: conn,
    });
    const [[row]] = await conn.query(
      `SELECT id, staff_id, amount, currency, reason, status, deduct_month, deduct_year,
              approved_by, approved_at, created_at FROM salary_advances WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    await conn.commit();
    transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/advances/create]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// Finance-facing queue: exposes only approved/disbursed advance records and
// applies the accountant's forced branch scope. HR-only pending/rejected
// workflow remains on the HR endpoint above.
router.get('/api/admin/finance/salary-advances', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchSql = scope.branchId ? ' AND s.branch_id=?' : '';
    const [rows] = await pool.query(
      `SELECT a.id,a.staff_id,a.amount,a.currency,a.reason,a.status,
              a.deduct_month,a.deduct_year,a.approved_at,a.disbursed_at,
              a.journal_entry_id,a.created_at,s.name AS staff_name,
              s.branch,s.branch_id,ap.name AS approved_by_name
         FROM salary_advances a
         JOIN staff s ON s.id=a.staff_id AND s.tenant_id=a.tenant_id
         LEFT JOIN staff ap ON ap.id=a.approved_by AND ap.tenant_id=a.tenant_id
        WHERE a.tenant_id=? AND a.status IN ('APPROVED','DISBURSED','DEDUCTED')${branchSql}
        ORDER BY FIELD(a.status,'APPROVED','DISBURSED','DEDUCTED'),a.created_at DESC
        LIMIT 500`,
      scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId],
    );
    res.json(rows);
  } catch (e) {
    logger.error('[finance/salary-advances]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// Approve / reject advance
router.put('/api/admin/hr/advances/:advId/status', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { status, deduct_month, deduct_year } = req.body;
    if (status === 'DEDUCTED') {
      return res.status(409).json({
        error: 'Only a paid payroll run can deduct an advance',
        code: 'PAYROLL_SETTLEMENT_REQUIRED',
      });
    }
    if (!['APPROVED','REJECTED'].includes(status)) return res.status(400).json({ error: 'invalid status' });
    await conn.beginTransaction();
    transactionStarted = true;
    const [[advance]] = await conn.query(
      `SELECT id,staff_id,requested_by,status,deduct_month,deduct_year
         FROM salary_advances WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.params.advId, req.tenantId]
    );
    if (!advance) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Advance not found' });
    }
    const transitions = { PENDING: ['APPROVED', 'REJECTED'] };
    if (!transitions[advance.status]?.includes(status)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: `Invalid advance transition: ${advance.status} → ${status}` });
    }
    const actorStaffId = String(req.staffRecord?.id || '');
    if (status === 'APPROVED' && actorStaffId
        && [advance.staff_id, advance.requested_by].some(id => String(id || '') === actorStaffId)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'لا يجوز اعتماد سلفة لنفسك', code: 'HR_SELF_APPROVAL' });
    }
    const nextMonth = deduct_month ?? advance.deduct_month;
    const nextYear = deduct_year ?? advance.deduct_year;
    if (status === 'APPROVED' && !validPeriod(nextMonth, nextYear)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'Deduction month and year are required before approval' });
    }
    const [updated] = await conn.query(
      `UPDATE salary_advances SET status=?,
        approved_by=IF(?='APPROVED',?,NULL),approved_at=IF(?='APPROVED',NOW(),NULL),
        deduct_month=COALESCE(?,deduct_month), deduct_year=COALESCE(?,deduct_year)
       WHERE id=? AND tenant_id=?`,
      [status, status, req.staffRecord?.id || null, status, deduct_month || null, deduct_year || null,
        req.params.advId, req.tenantId]
    );
    if (!updated.affectedRows) return res.status(404).json({ error: 'Advance not found' });
    const [[row]] = await conn.query(
      `SELECT id, staff_id, amount, currency, reason, status, deduct_month, deduct_year,
              approved_by, approved_at, created_at FROM salary_advances WHERE id=? AND tenant_id=?`,
      [req.params.advId, req.tenantId]
    );
    await writeAuditEvent({
      action: `hr.advance.${status.toLowerCase()}`,
      entityType: 'salary_advance',
      entityId: req.params.advId,
      severity: status === 'APPROVED' ? 'warning' : 'info',
      metadata: { staff_id: advance.staff_id, deduct_month: nextMonth || null, deduct_year: nextYear || null },
      req,
      db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/advances/status]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

router.put('/api/admin/hr/advances/:advId/disburse', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const scope = resolveFinancialScope(req);
    await conn.beginTransaction();
    transactionStarted = true;
    const [[advance]] = await conn.query(
      `SELECT a.id,a.staff_id,a.amount,a.currency,a.status,a.approved_by,s.name AS staff_name,
              s.branch,s.branch_id
         FROM salary_advances a
         JOIN staff s ON s.id=a.staff_id AND s.tenant_id=a.tenant_id
        WHERE a.id=? AND a.tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.params.advId, req.tenantId]
    );
    if (!advance) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Advance not found' });
    }
    if (!financialRecordMatches(scope, advance)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Advance not found' });
    }
    if (advance.status !== 'APPROVED') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Only approved advances can be disbursed' });
    }
    const actorId = req.staffRecord?.id || req.user?.uid || null;
    if (!actorId || String(actorId) === String(advance.approved_by || '')) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Advance approval and disbursement require separate actors', code: 'ADVANCE_SOD' });
    }
    const amountEgp = await toEgp(Number(advance.amount), advance.currency, req.tenantId);
    if (!Number.isFinite(amountEgp) || amountEgp <= 0) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Valid FX rate is required before disbursement', code: 'FX_RATE_REQUIRED' });
    }
    const journalId = await postJournalEntry(
      'salary_advance',
      advance.id,
      dateOnlyInTimeZone(),
      `Employee advance: ${advance.staff_name}`,
      [
        { account_code: '1300', account_name: 'Employee advances receivable', debit: amountEgp, credit: 0 },
        { account_code: '1100', account_name: 'Cash and banks', debit: 0, credit: amountEgp },
      ],
      req.user?.email || 'system',
      conn,
      req.tenantId,
      { branch: advance.branch || null, branchId: advance.branch_id || null },
    );
    if (!journalId) throw new Error('Advance journal posting failed');
    await conn.query(
      `UPDATE salary_advances
          SET status='DISBURSED',disbursed_by=?,disbursed_at=NOW(),journal_entry_id=?
        WHERE id=? AND tenant_id=?`,
      [actorId, journalId, advance.id, req.tenantId]
    );
    await writeAuditEvent({
      action: 'hr.advance.disbursed',
      entityType: 'salary_advance',
      entityId: advance.id,
      severity: 'critical',
      metadata: { staff_id: advance.staff_id, amount_egp: amountEgp, journal_entry_id: journalId },
      req,
      db: conn,
    });
    await logFinancialAudit({
      entityType: 'salary_advance',
      entityId: advance.id,
      action: 'disbursed',
      oldData: { status: 'APPROVED' },
      newData: { status: 'DISBURSED', journal_entry_id: journalId },
      amount: amountEgp,
      actor: req.user?.email || 'system',
      tenantId: req.tenantId,
      db: conn,
      strict: true,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, status: 'DISBURSED', journal_entry_id: journalId, amount_egp: amountEgp });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/advances/disburse]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// Delete advance (admin, pending only)
router.delete('/api/admin/hr/advances/:advId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    await conn.beginTransaction();
    transactionStarted = true;
    const [[advance]] = await conn.query(
      `SELECT id,staff_id,status FROM salary_advances
        WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.params.advId, req.tenantId]
    );
    if (!advance || advance.status !== 'PENDING') {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Pending advance not found' });
    }
    await writeAuditEvent({
      action: 'hr.advance.deleted',
      entityType: 'salary_advance',
      entityId: advance.id,
      severity: 'warning',
      metadata: { staff_id: advance.staff_id },
      req,
      db: conn,
    });
    await conn.query('DELETE FROM salary_advances WHERE id=? AND tenant_id=?', [advance.id, req.tenantId]);
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/advances/delete]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// ══════════════════════════════════════════════════════════════
// HR v15 — Disciplinary Records
// ══════════════════════════════════════════════════════════════

router.get('/api/admin/hr/disciplinary', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const { staff_id } = req.query;
    let sql = `SELECT d.*, s.name AS staff_name, s.role, s.image,
        i.name AS issued_by_name
      FROM disciplinary_records d
      JOIN staff s ON s.id=d.staff_id AND s.tenant_id=d.tenant_id
      LEFT JOIN staff i ON i.id=d.issued_by AND i.tenant_id=d.tenant_id
      WHERE d.tenant_id=? AND d.deleted_at IS NULL`;
    const params = [req.tenantId];
    if (staff_id) { sql += ' AND d.staff_id=?'; params.push(staff_id); }
    sql += ' ORDER BY d.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/hr/disciplinary', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { staff_id, type, severity, title, description, incident_date, action_taken } = req.body;
    const normalizedType = type || 'warning';
    const normalizedSeverity = severity || 'medium';
    if (!staff_id || !cleanText(title, 300)) return res.status(400).json({ error: 'staff_id and title required' });
    if (!DISCIPLINARY_TYPES.has(normalizedType)
        || !DISCIPLINARY_SEVERITIES.has(normalizedSeverity)
        || !validDate(incident_date)) {
      return res.status(400).json({ error: 'Invalid disciplinary type, severity, or incident date' });
    }
    const id = uuidv4();
    await conn.beginTransaction();
    transactionStarted = true;
    const [created] = await conn.query(
      `INSERT INTO disciplinary_records (id, tenant_id, staff_id, type, severity, title, description, incident_date, action_taken, issued_by)
       SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL)`,
      [id, req.tenantId, staff_id, normalizedType, normalizedSeverity, cleanText(title, 300),
        cleanText(description, 5000), incident_date || null, cleanText(action_taken, 5000),
        req.staffRecord?.id || null, staff_id, req.tenantId]
    );
    if (!created.affectedRows) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Employee not found' });
    }
    await writeAuditEvent({
      action: 'hr.disciplinary.issued',
      entityType: 'disciplinary_record',
      entityId: id,
      severity: normalizedSeverity === 'high' ? 'critical' : 'warning',
      metadata: { staff_id, type: normalizedType, severity: normalizedSeverity },
      req,
      db: conn,
    });
    const [[row]] = await conn.query(
      `SELECT id, staff_id, type, severity, title, description, incident_date, action_taken,
              issued_by, acknowledged_at, acknowledged_by, status, created_at
       FROM disciplinary_records WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    await conn.commit();
    transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/disciplinary/create]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

router.put('/api/admin/hr/disciplinary/:recId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    await conn.beginTransaction();
    transactionStarted = true;
    const [[record]] = await conn.query(
      `SELECT id,staff_id,type,severity,status,acknowledged_at
         FROM disciplinary_records
        WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.params.recId, req.tenantId]
    );
    if (!record) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Record not found' });
    }
    const contentFields = ['type','severity','title','description','incident_date','action_taken'];
    if ((record.acknowledged_at || record.status !== 'open')
        && contentFields.some(field => req.body[field] !== undefined)) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(409).json({
        error: 'Acknowledged or progressed records are immutable',
        code: 'DISCIPLINARY_IMMUTABLE',
      });
    }
    if ((req.body.type !== undefined && !DISCIPLINARY_TYPES.has(req.body.type))
        || (req.body.severity !== undefined && !DISCIPLINARY_SEVERITIES.has(req.body.severity))
        || (req.body.incident_date !== undefined && !validDate(req.body.incident_date))) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(400).json({ error: 'Invalid disciplinary fields' });
    }
    if (req.body.status !== undefined && !(record.status === 'appealed' && req.body.status === 'resolved')) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'Invalid status transition' });
    }
    const fields = [...contentFields, 'status'];
    const sets = []; const vals = [];
    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      sets.push(`${field}=?`);
      vals.push(field === 'title' ? cleanText(req.body[field], 300)
        : ['description', 'action_taken'].includes(field) ? cleanText(req.body[field], 5000)
          : req.body[field]);
    }
    if (!sets.length) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(400).json({ error: 'nothing to update' });
    }
    sets.push('updated_at=NOW()');
    vals.push(req.params.recId, req.tenantId);
    await conn.query(`UPDATE disciplinary_records SET ${sets.join(',')} WHERE id=? AND tenant_id=?`, vals);
    await writeAuditEvent({
      action: req.body.status === 'resolved' ? 'hr.disciplinary.resolved' : 'hr.disciplinary.updated',
      entityType: 'disciplinary_record',
      entityId: record.id,
      severity: 'warning',
      metadata: { staff_id: record.staff_id, changed_fields: fields.filter(field => req.body[field] !== undefined) },
      req,
      db: conn,
    });
    const [[row]] = await conn.query(
      `SELECT id, staff_id, type, severity, title, description, incident_date, action_taken,
              issued_by, acknowledged_at, acknowledged_by, status, created_at
       FROM disciplinary_records WHERE id=? AND tenant_id=?`, [req.params.recId, req.tenantId]
    );
    await conn.commit();
    transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/disciplinary/update]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// Legacy admin endpoint intentionally fails closed; acknowledgement belongs to the employee.
router.put('/api/admin/hr/disciplinary/:recId/acknowledge', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  res.status(409).json({
    error: 'Employee self-service acknowledgement required',
    code: 'EMPLOYEE_ACK_REQUIRED',
  });
});

router.delete('/api/admin/hr/disciplinary/:recId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  res.status(409).json({
    error: 'Disciplinary records are immutable audit records',
    code: 'DISCIPLINARY_IMMUTABLE',
  });
});

// ══════════════════════════════════════════════════════════════
// HR v15 — Employee Documents Vault
// ══════════════════════════════════════════════════════════════

router.get('/api/admin/hr/documents', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const { staff_id } = req.query;
    let sql = `SELECT d.*, u.name AS uploaded_by_name
      FROM employee_documents d LEFT JOIN staff u ON u.id=d.uploaded_by AND u.tenant_id=d.tenant_id
      WHERE d.tenant_id=?`;
    const params = [req.tenantId];
    if (staff_id) { sql += ' AND d.staff_id=?'; params.push(staff_id); }
    sql += ' ORDER BY d.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/hr/documents', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { staff_id, title, category, file_url, file_name, expiry_date } = req.body;
    const normalizedCategory = category || 'other';
    const normalizedUrl = safeDocumentUrl(file_url);
    if (!staff_id || !cleanText(title, 300)) return res.status(400).json({ error: 'staff_id and title required' });
    if (!DOCUMENT_CATEGORIES.has(normalizedCategory) || normalizedUrl === false || !validDate(expiry_date)) {
      return res.status(400).json({ error: 'Invalid document category, URL, or expiry date' });
    }
    const id = uuidv4();
    await conn.beginTransaction();
    transactionStarted = true;
    const [created] = await conn.query(
      `INSERT INTO employee_documents (id, tenant_id, staff_id, title, category, file_url, file_name, expiry_date, uploaded_by)
       SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL)`,
      [id, req.tenantId, staff_id, cleanText(title, 300), normalizedCategory, normalizedUrl,
        cleanText(file_name, 300), expiry_date || null, req.staffRecord?.id || null, staff_id, req.tenantId]
    );
    if (!created.affectedRows) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Employee not found' });
    }
    await writeAuditEvent({
      action: 'hr.document.created',
      entityType: 'employee_document',
      entityId: id,
      metadata: { staff_id, category: normalizedCategory },
      req,
      db: conn,
    });
    const [[row]] = await conn.query(
      `SELECT id, staff_id, title, category, file_url, file_name, expiry_date, uploaded_by, created_at
       FROM employee_documents WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    await conn.commit();
    transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/documents/create]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

router.delete('/api/admin/hr/documents/:docId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    await conn.beginTransaction();
    transactionStarted = true;
    const [deleted] = await conn.query(
      `UPDATE employee_documents SET deleted_at=NOW(),deleted_by=?
        WHERE id=? AND tenant_id=? AND deleted_at IS NULL`,
      [req.staffRecord?.id || null, req.params.docId, req.tenantId]
    );
    if (!deleted.affectedRows) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Document not found' });
    }
    await writeAuditEvent({
      action: 'hr.document.deleted',
      entityType: 'employee_document',
      entityId: req.params.docId,
      severity: 'warning',
      req,
      db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/documents/delete]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// Self-service: get own advances + disciplinary (read-only)
router.get('/api/staff/me/advances', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.json([]);
    const [rows] = await pool.query(
      `SELECT a.*, ap.name AS approved_by_name
       FROM salary_advances a LEFT JOIN staff ap ON ap.id=a.approved_by AND ap.tenant_id=a.tenant_id
       WHERE a.staff_id=? AND a.tenant_id=? ORDER BY a.created_at DESC`,
      [staff.id, req.tenantId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Self-service: submit own advance request
router.post('/api/staff/me/advances', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(403).json({ error: 'Staff record not found' });
    const { amount, currency, reason } = req.body;
    const normalizedCurrency = cleanCurrency(currency);
    if (!validMoney(amount)) {
      return res.status(400).json({ error: 'Positive amount required' });
    }
    if (!CURRENCIES.has(normalizedCurrency)) return res.status(400).json({ error: 'Unsupported currency' });
    const id = uuidv4();
    await conn.beginTransaction();
    transactionStarted = true;
    await conn.query(
      `INSERT INTO salary_advances (id, tenant_id, staff_id, amount, currency, reason, requested_by)
       VALUES (?,?,?,?,?,?,?)`,
      [id, req.tenantId, staff.id, Number(amount), normalizedCurrency, cleanText(reason, 2000), staff.id]
    );
    await writeAuditEvent({
      action: 'hr.advance.requested',
      entityType: 'salary_advance',
      entityId: id,
      metadata: { staff_id: staff.id, amount: Number(amount), currency: normalizedCurrency },
      req,
      db: conn,
    });
    const [[row]] = await conn.query(
      `SELECT id, staff_id, amount, currency, reason, status, deduct_month, deduct_year,
              approved_by, approved_at, created_at FROM salary_advances WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    await conn.commit();
    transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/advances/self-create]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

router.get('/api/staff/me/disciplinary', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id,type,severity,title,description,incident_date,action_taken,appeal_note,
              acknowledged_at,status,created_at,updated_at
         FROM disciplinary_records
        WHERE staff_id=? AND tenant_id=? ORDER BY created_at DESC`,
      [staff.id, req.tenantId]
    );
    res.json(rows);
  } catch (e) {
    logger.error('[hr/disciplinary/self-list]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/staff/me/disciplinary/:recId/acknowledge', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(403).json({ error: 'Staff record not found' });
    await conn.beginTransaction();
    transactionStarted = true;
    const [[record]] = await conn.query(
      `SELECT id,status FROM disciplinary_records
        WHERE id=? AND tenant_id=? AND staff_id=? LIMIT 1 FOR UPDATE`,
      [req.params.recId, req.tenantId, staff.id]
    );
    if (!record) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Record not found' });
    }
    if (record.status !== 'open') {
      await conn.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'Record cannot be acknowledged in its current status' });
    }
    await conn.query(
      `UPDATE disciplinary_records
          SET acknowledged_at=NOW(),acknowledged_by=?,status='acknowledged',updated_at=NOW()
        WHERE id=? AND tenant_id=?`,
      [staff.id, record.id, req.tenantId]
    );
    await writeAuditEvent({
      action: 'hr.disciplinary.acknowledged',
      entityType: 'disciplinary_record',
      entityId: record.id,
      metadata: { staff_id: staff.id },
      req,
      db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/disciplinary/acknowledge]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

router.put('/api/staff/me/disciplinary/:recId/appeal', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const staff = await _resolveStaffByUser(req);
    const appealNote = cleanText(req.body?.appeal_note, 5000);
    if (!staff) return res.status(403).json({ error: 'Staff record not found' });
    if (!appealNote) return res.status(400).json({ error: 'appeal_note required' });
    await conn.beginTransaction();
    transactionStarted = true;
    const [[record]] = await conn.query(
      `SELECT id,status FROM disciplinary_records
        WHERE id=? AND tenant_id=? AND staff_id=? LIMIT 1 FOR UPDATE`,
      [req.params.recId, req.tenantId, staff.id]
    );
    if (!record) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Record not found' });
    }
    if (!['open', 'acknowledged'].includes(record.status)) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'Record cannot be appealed in its current status' });
    }
    await conn.query(
      `UPDATE disciplinary_records SET status='appealed',appeal_note=?,updated_at=NOW()
        WHERE id=? AND tenant_id=?`,
      [appealNote, record.id, req.tenantId]
    );
    await writeAuditEvent({
      action: 'hr.disciplinary.appealed',
      entityType: 'disciplinary_record',
      entityId: record.id,
      severity: 'warning',
      metadata: { staff_id: staff.id },
      req,
      db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/disciplinary/appeal]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// Self-service: get own documents
router.get('/api/staff/me/documents', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id, staff_id, title, category, file_url, file_name, expiry_date, uploaded_by, created_at
       FROM employee_documents
       WHERE staff_id=? AND tenant_id=? AND deleted_at IS NULL ORDER BY created_at DESC`,
      [staff.id, req.tenantId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v16 — Instructor Rates
// ══════════════════════════════════════════════════════════════

module.exports = router;
