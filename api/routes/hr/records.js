'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');

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
  try {
    const { staff_id, amount, currency, reason, deduct_month, deduct_year } = req.body;
    if (!staff_id || !amount) return res.status(400).json({ error: 'staff_id and amount required' });
    const id = uuidv4();
    const [created] = await pool.query(
      `INSERT INTO salary_advances (id, tenant_id, staff_id, amount, currency, reason, deduct_month, deduct_year)
       SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL)`,
      [id, req.tenantId, staff_id, amount, currency||'EGP', reason||null, deduct_month||null, deduct_year||null, staff_id, req.tenantId]
    );
    if (!created.affectedRows) return res.status(404).json({ error: 'Employee not found' });
    const [[row]] = await pool.query(
      `SELECT id, staff_id, amount, currency, reason, status, deduct_month, deduct_year,
              approved_by, approved_at, created_at FROM salary_advances WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Approve / reject advance
router.put('/api/admin/hr/advances/:advId/status', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { status, deduct_month, deduct_year } = req.body;
    if (!['APPROVED','REJECTED','DEDUCTED'].includes(status)) return res.status(400).json({ error: 'invalid status' });
    const [updated] = await pool.query(
      `UPDATE salary_advances SET status=?, approved_by=?, approved_at=NOW(),
        deduct_month=COALESCE(?,deduct_month), deduct_year=COALESCE(?,deduct_year)
       WHERE id=? AND tenant_id=?`,
      [status, req.staffRecord?.id||null, deduct_month||null, deduct_year||null, req.params.advId, req.tenantId]
    );
    if (!updated.affectedRows) return res.status(404).json({ error: 'Advance not found' });
    const [[row]] = await pool.query(
      `SELECT id, staff_id, amount, currency, reason, status, deduct_month, deduct_year,
              approved_by, approved_at, created_at FROM salary_advances WHERE id=? AND tenant_id=?`,
      [req.params.advId, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Delete advance (admin, pending only)
router.delete('/api/admin/hr/advances/:advId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [deleted] = await pool.query(`DELETE FROM salary_advances WHERE id=? AND tenant_id=? AND status='PENDING'`, [req.params.advId, req.tenantId]);
    if (!deleted.affectedRows) return res.status(404).json({ error: 'Pending advance not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
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
      WHERE d.tenant_id=?`;
    const params = [req.tenantId];
    if (staff_id) { sql += ' AND d.staff_id=?'; params.push(staff_id); }
    sql += ' ORDER BY d.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/hr/disciplinary', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { staff_id, type, severity, title, description, incident_date, action_taken } = req.body;
    if (!staff_id || !title) return res.status(400).json({ error: 'staff_id and title required' });
    const id = uuidv4();
    const [created] = await pool.query(
      `INSERT INTO disciplinary_records (id, tenant_id, staff_id, type, severity, title, description, incident_date, action_taken, issued_by)
       SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL)`,
      [id, req.tenantId, staff_id, type||'warning', severity||'medium', title, description||null, incident_date||null, action_taken||null, req.staffRecord?.id||null, staff_id, req.tenantId]
    );
    if (!created.affectedRows) return res.status(404).json({ error: 'Employee not found' });
    const [[row]] = await pool.query(
      `SELECT id, staff_id, type, severity, title, description, incident_date, action_taken,
              issued_by, acknowledged_at, acknowledged_by, status, created_at
       FROM disciplinary_records WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/hr/disciplinary/:recId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const fields = ['type','severity','title','description','incident_date','action_taken','status'];
    const sets = []; const vals = [];
    for (const f of fields) { if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); } }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(req.params.recId, req.tenantId);
    const [updated] = await pool.query(`UPDATE disciplinary_records SET ${sets.join(',')} WHERE id=? AND tenant_id=?`, vals);
    if (!updated.affectedRows) return res.status(404).json({ error: 'Record not found' });
    const [[row]] = await pool.query(
      `SELECT id, staff_id, type, severity, title, description, incident_date, action_taken,
              issued_by, acknowledged_at, acknowledged_by, status, created_at
       FROM disciplinary_records WHERE id=? AND tenant_id=?`, [req.params.recId, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Acknowledge (by the employee themselves)
router.put('/api/admin/hr/disciplinary/:recId/acknowledge', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [updated] = await pool.query(
      `UPDATE disciplinary_records SET acknowledged_at=NOW(), acknowledged_by=?, status='acknowledged' WHERE id=? AND tenant_id=?`,
      [req.staffRecord?.id||null, req.params.recId, req.tenantId]
    );
    if (!updated.affectedRows) return res.status(404).json({ error: 'Record not found' });
    const [[row]] = await pool.query(
      `SELECT id, staff_id, type, severity, title, description, incident_date, action_taken,
              issued_by, acknowledged_at, acknowledged_by, status, created_at
       FROM disciplinary_records WHERE id=? AND tenant_id=?`, [req.params.recId, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/hr/disciplinary/:recId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [deleted] = await pool.query('DELETE FROM disciplinary_records WHERE id=? AND tenant_id=?', [req.params.recId, req.tenantId]);
    if (!deleted.affectedRows) return res.status(404).json({ error: 'Record not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
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
  try {
    const { staff_id, title, category, file_url, file_name, expiry_date } = req.body;
    if (!staff_id || !title) return res.status(400).json({ error: 'staff_id and title required' });
    const id = uuidv4();
    const [created] = await pool.query(
      `INSERT INTO employee_documents (id, tenant_id, staff_id, title, category, file_url, file_name, expiry_date, uploaded_by)
       SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL)`,
      [id, req.tenantId, staff_id, title, category||'other', file_url||null, file_name||null, expiry_date||null, req.staffRecord?.id||null, staff_id, req.tenantId]
    );
    if (!created.affectedRows) return res.status(404).json({ error: 'Employee not found' });
    const [[row]] = await pool.query(
      `SELECT id, staff_id, title, category, file_url, file_name, expiry_date, uploaded_by, created_at
       FROM employee_documents WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/hr/documents/:docId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [deleted] = await pool.query('DELETE FROM employee_documents WHERE id=? AND tenant_id=?', [req.params.docId, req.tenantId]);
    if (!deleted.affectedRows) return res.status(404).json({ error: 'Document not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
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
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.status(403).json({ error: 'Staff record not found' });
    const { amount, currency, reason } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO salary_advances (id, tenant_id, staff_id, amount, currency, reason) VALUES (?,?,?,?,?,?)`,
      [id, req.tenantId, staff.id, amount, currency||'EGP', reason||null]
    );
    const [[row]] = await pool.query(
      `SELECT id, staff_id, amount, currency, reason, status, deduct_month, deduct_year,
              approved_by, approved_at, created_at FROM salary_advances WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Self-service: get own documents
router.get('/api/staff/me/documents', requireAuth, async (req, res) => {
  try {
    const staff = await _resolveStaffByUser(req);
    if (!staff) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id, staff_id, title, category, file_url, file_name, expiry_date, uploaded_by, created_at
       FROM employee_documents WHERE staff_id=? AND tenant_id=? ORDER BY created_at DESC`,
      [staff.id, req.tenantId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v16 — Instructor Rates
// ══════════════════════════════════════════════════════════════

module.exports = router;
