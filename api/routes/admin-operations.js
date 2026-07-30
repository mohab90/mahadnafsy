'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'admin-operations-route' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { parseLimit, parseOffset } = require('../lib/helpers');
const { branchForId, branchIdForBranch, defaultDigitalBranch } = require('../lib/branches');
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { postExpenseJournal } = require('../lib/finance');
const { financialRecordMatches, resolveFinancialScope } = require('../lib/financialScope');
const { assertWritable } = require('../lib/periodLock');
const { writeAuditEvent } = require('../lib/auditTrail');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');

function routeError(res, error, message = 'admin operations route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

function appendTenantScope(sql, alias, tenantId, params) {
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  const effectiveTenantId = tenantId || DEFAULT_TENANT_ID;
  params.push(effectiveTenantId);
  if (effectiveTenantId === DEFAULT_TENANT_ID) {
    return `${sql} AND (${col} = ? OR ${col} IS NULL OR ${col} = '')`;
  }
  return `${sql} AND ${col} = ?`;
}

const EXPENSE_CATEGORY_DB = Object.freeze({
  'رواتب': 'SALARIES',
  'تسويق': 'MARKETING',
  'إيجار': 'RENT',
  'برمجيات': 'SOFTWARE',
  'معدات': 'EQUIPMENT',
  'أخرى': 'OTHER',
});
const EXPENSE_CATEGORY_LABEL = Object.freeze(
  Object.fromEntries(Object.entries(EXPENSE_CATEGORY_DB).map(([label, code]) => [code, label]))
);
const VALID_EXPENSE_CURRENCIES = new Set(['EGP', 'SAR', 'USD']);
function expenseCategory(value) {
  const key = String(value || 'OTHER').trim();
  const code = EXPENSE_CATEGORY_DB[key] || key.toUpperCase();
  return EXPENSE_CATEGORY_LABEL[code] ? code : 'OTHER';
}
function expenseDate(value) {
  const date = String(value || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())
    ? date
    : null;
}

router.get('/api/admin/expenses', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchSql = scope.branchId ? ' AND branch_id=?' : '';
    const params = scope.branchId ? [scopedTenantId(req), scope.branchId] : [scopedTenantId(req)];
    const [rows] = await pool.query(
      `SELECT id, description, amount, currency, fx_rate_to_egp, amount_egp, fx_source,
       category, date, receipt_url, note, staff_id, branch_id,
       vat_rate, vat_amount, amount_before_vat, created_at
       FROM expenses WHERE tenant_id=? AND deleted_at IS NULL${branchSql}
       ORDER BY date DESC LIMIT 500`,
      params);
    res.json(rows.map(row => ({
      ...row,
      category: EXPENSE_CATEGORY_LABEL[row.category] || 'أخرى',
      receiptUrl: row.receipt_url || '',
      branchType: branchForId(row.branch_id),
      createdAt: row.created_at,
    })));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    routeError(res, e);
  }
});

router.post('/api/admin/expenses', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const e2 = req.body;
    const id = uuidv4();
    const tenantId = scopedTenantId(req);
    const scope = resolveFinancialScope(req, { requestedBranch: e2.branchType || e2.branch || null });
    const branchCode = scope.branch || defaultDigitalBranch(e2.branchType || e2.branch);
    const branchId = scope.branchId || branchIdForBranch(branchCode);
    const expDate = expenseDate(e2.date);
    const amount = Number(e2.amount);
    const currency = String(e2.currency || 'EGP').toUpperCase();
    if (!expDate) return res.status(400).json({ error: 'Invalid expense date' });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: 'Expense amount must be positive' });
    if (!VALID_EXPENSE_CURRENCIES.has(currency)) return res.status(400).json({ error: 'Invalid expense currency' });
    await conn.beginTransaction();
    transactionStarted = true;
    await assertWritable(expDate, conn, tenantId);
    // Column is `note` (singular) in the real schema — inserting into `notes`
    // threw "Unknown column 'notes'" and silently broke ALL expense creation
    // (confirmed: expenses table was empty in prod). Accept either field name.
    await conn.query(
      `INSERT INTO expenses
         (id, tenant_id, branch_id, date, description, amount, currency, category, receipt_url, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, tenantId, branchId, expDate, String(e2.description || '').trim().slice(0, 2000),
       amount, currency, expenseCategory(e2.category), String(e2.receiptUrl || e2.receipt_url || '').slice(0, 2000) || null, e2.note ?? e2.notes ?? null,
       e2.created_at || new Date().toISOString()]
    );
    const journalId = await postExpenseJournal(
      { id, tenant_id: tenantId, branch_id: branchId, date: expDate, description: e2.description, amount, currency, category: expenseCategory(e2.category) },
      +1, req.user?.email, conn, tenantId
    );
    if (!journalId) throw new Error('Expense journal posting failed');
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, id });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    routeError(res, e);
  } finally { conn.release(); }
});

router.patch('/api/admin/expenses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const e2 = req.body;
    const tenantId = scopedTenantId(req);
    const amount = Number(e2.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: 'Expense amount must be positive' });
    await conn.beginTransaction();
    transactionStarted = true;
    // Fetch the old row (in tenant scope) so its ledger entry can be reversed.
    const [[oldExp]] = await conn.query(
      `SELECT id, tenant_id, branch_id, date, description, amount, currency, fx_rate_to_egp, amount_egp, category, receipt_url, note
       FROM expenses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [req.params.id, tenantId]
    );
    if (!oldExp) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Expense not found' });
    }
    const sourceScope = resolveFinancialScope(req);
    if (!financialRecordMatches(sourceScope, oldExp)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'Expense is outside your financial scope' });
    }
    const targetScope = resolveFinancialScope(req, { requestedBranch: e2.branchType || e2.branch || null });
    const targetBranchId = targetScope.branchId || oldExp.branch_id;
    const newDate = expenseDate(e2.date || oldExp.date);
    const currency = String(e2.currency || oldExp.currency || 'EGP').toUpperCase();
    if (!newDate || !VALID_EXPENSE_CURRENCIES.has(currency)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'Invalid expense date or currency' });
    }
    await assertWritable(oldExp.date, conn, tenantId);
    if (newDate !== String(oldExp.date).slice(0, 10)) await assertWritable(newDate, conn, tenantId);
    // `note` (singular) is the real column — `notes` does not exist.
    await conn.query(
      `UPDATE expenses
          SET description=?, amount=?, currency=?, category=?, date=?, receipt_url=?, note=?, branch_id=?
        WHERE id=? AND tenant_id=?`,
      [String(e2.description || '').trim().slice(0, 2000), amount, currency, expenseCategory(e2.category),
       newDate, String(e2.receiptUrl || e2.receipt_url || '').slice(0, 2000) || null,
       e2.note ?? e2.notes ?? oldExp.note ?? null, targetBranchId, req.params.id, tenantId]
    );
    const reversalId = await postExpenseJournal(oldExp, -1, req.user?.email, conn, tenantId);
    const journalId = await postExpenseJournal(
      { ...oldExp, ...e2, amount, currency, date: newDate, category: expenseCategory(e2.category), branch_id: targetBranchId, id: req.params.id, tenant_id: tenantId },
      +1, req.user?.email, conn, tenantId
    );
    if (!reversalId || !journalId) throw new Error('Expense ledger update failed');
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    routeError(res, e);
  } finally { conn.release(); }
});

router.delete('/api/admin/expenses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    // Soft delete (recoverable + auditable), NOT a hard DELETE. Every financial
    // report already filters `WHERE deleted_at IS NULL` (finance.js, analytics/
    // financial.js, campaigns.js, misc/analytics.js), so a soft-deleted expense
    // disappears from all reports exactly like a hard delete did — same visible
    // behavior — but the row survives for recovery and audit instead of destroyed.
    // The `deleted_at` column is owned by migration 017.
    const tenantId = scopedTenantId(req);
    await conn.beginTransaction();
    transactionStarted = true;
    const [[oldExp]] = await conn.query(
      `SELECT id, tenant_id, branch_id, date, description, amount, currency, fx_rate_to_egp, amount_egp, category
       FROM expenses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [req.params.id, tenantId]
    );
    if (!oldExp) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Expense not found' });
    }
    const scope = resolveFinancialScope(req);
    if (!financialRecordMatches(scope, oldExp)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'Expense is outside your financial scope' });
    }
    await assertWritable(oldExp.date, conn, tenantId);
    const [del] = await conn.query(
      'UPDATE expenses SET deleted_at=NOW() WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
      [req.params.id, tenantId]
    );
    // Reverse the ledger entry only on a real live->deleted transition, so a
    // double-delete can't post two reversals.
    if (!del.affectedRows) throw new Error('Expense deletion failed');
    const reversalId = await postExpenseJournal(oldExp, -1, req.user?.email, conn, tenantId);
    if (!reversalId) throw new Error('Expense reversal posting failed');
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    routeError(res, e);
  } finally { conn.release(); }
});

router.get('/api/admin/activity-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 200, 500);
    const offset = parseOffset(req.query.offset);
    const [rows] = await pool.query(
      'SELECT id, action, entity, entity_id, label, actor, at FROM activity_logs WHERE tenant_id=? ORDER BY at DESC LIMIT ? OFFSET ?',
      [req.tenantId, limit, offset]);
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/activity-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const a = req.body;
    const id = a.id || uuidv4();
    await pool.query(
      'INSERT IGNORE INTO activity_logs (id, tenant_id, action, entity, entity_id, label, actor, at) VALUES (?,?,?,?,?,?,?,?)',
      [id, req.tenantId, a.action || '', a.entity || '', a.entity_id || null,
       a.label || a.entity_name || a.entity || 'activity', a.actor || a.user_id || req.user.uid,
       a.at || new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) { routeError(res, e); }
});

router.get('/api/admin/join-us', requireAuth, requireAdminOrStaff, requirePermission('view_join_us'), async (req, res) => {
  try {
    const params = [];
    let where = appendTenantScope('WHERE 1=1', 'j', scopedTenantId(req), params);
    if (req.query.type && req.query.type !== 'all') {
      where += ' AND j.type = ?';
      params.push(String(req.query.type).toUpperCase());
    }
    const [rows] = await pool.query(
      `SELECT j.id, j.name, j.email, j.phone, j.specialty, j.experience, j.type,
              j.linkedin, j.message, j.status, j.admin_note, j.created_at,
              j.converted_applicant_id, j.reviewed_at, j.assigned_to,
              a.stage applicant_stage, a.hired_staff_id
         FROM join_us_applications j
         LEFT JOIN job_applicants a
           ON a.id=j.converted_applicant_id AND a.tenant_id=j.tenant_id
         ${where}
        ORDER BY j.created_at DESC LIMIT 500`,
      params);
    res.json(rows.map(r => ({
      ...r,
      application_category: String(r.type || '').toUpperCase() === 'EMPLOYEE' ? 'HR' : 'ACADEMIC',
    })));
  } catch (e) { routeError(res, e); }
});

router.patch('/api/admin/join-us/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_join_us'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { status, notes } = req.body;
    const nextStatus = String(status || '').toUpperCase();
    if (!['NEW', 'REVIEWED', 'ACCEPTED', 'REJECTED'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid application status' });
    }
    await conn.beginTransaction();
    const [[application]] = await conn.query(
      'SELECT id,status FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, scopedTenantId(req)]
    );
    if (!application) {
      await conn.rollback();
      return res.status(404).json({ error: 'Application not found' });
    }
    await conn.query(
      `UPDATE join_us_applications
          SET status=?,admin_note=?,reviewed_at=COALESCE(reviewed_at,NOW())
        WHERE id=? AND tenant_id=?`,
      [nextStatus, notes === undefined ? null : notes || null, req.params.id, scopedTenantId(req)]
    );
    await writeAuditEvent({
      action: 'hr.join_application.updated',
      entityType: 'join_us_application',
      entityId: req.params.id,
      metadata: { from: application.status, to: nextStatus },
      req,
      db: conn,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    routeError(res, e);
  } finally {
    conn.release();
  }
});

router.delete('/api/admin/join-us/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_join_us'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[application]] = await conn.query(
      'SELECT id,converted_applicant_id FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, scopedTenantId(req)]
    );
    if (!application) {
      await conn.rollback();
      return res.status(404).json({ error: 'Application not found' });
    }
    if (application.converted_applicant_id) {
      await conn.rollback();
      return res.status(409).json({ error: 'Pipeline applications cannot be deleted; reject them instead', code: 'APPLICATION_IN_PIPELINE' });
    }
    await conn.query(
      'DELETE FROM join_us_applications WHERE id=? AND tenant_id=?',
      [req.params.id, scopedTenantId(req)]
    );
    await writeAuditEvent({
      action: 'hr.join_application.deleted',
      entityType: 'join_us_application',
      entityId: req.params.id,
      severity: 'warning',
      req,
      db: conn,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    routeError(res, e);
  } finally {
    conn.release();
  }
});

router.get('/api/admin/contact-messages', requireAuth, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status && req.query.status !== 'all' ? String(req.query.status) : null;
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, subject, message, status, admin_note, created_at
       FROM contact_messages
       WHERE tenant_id=? AND (? IS NULL OR status=?)
       ORDER BY created_at DESC LIMIT 500`,
      [scopedTenantId(req), status, status]);
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.patch('/api/admin/contact-messages/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      'UPDATE contact_messages SET status=? WHERE id=? AND tenant_id=?',
      [req.body.status || 'new', req.params.id, scopedTenantId(req)]
    );
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.delete('/api/admin/contact-messages/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM contact_messages WHERE id=? AND tenant_id=?',
      [req.params.id, scopedTenantId(req)]
    );
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.get('/api/admin/quiz-attempts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      'SELECT id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at FROM quiz_attempts WHERE tenant_id=? ORDER BY taken_at DESC LIMIT ?',
      [scopedTenantId(req), limit]
    );
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/next-client-code', requireAuth, requireAdmin, async (_req, res) => {
  try {
    await pool.query('UPDATE client_code_counter SET next_value = next_value + 1 WHERE id = 1');
    const [[row]] = await pool.query('SELECT next_value FROM client_code_counter WHERE id = 1');
    const code = `C${(row.next_value - 1)}`;
    res.json({ ok: true, code });
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/sync-client-code-counter', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[subMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM subscribers WHERE tenant_id=? AND client_code REGEXP '^C[0-9]+$'`,
      [scopedTenantId(req)]
    );
    const [[leadMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM leads WHERE tenant_id=? AND client_code REGEXP '^C[0-9]+$'`,
      [scopedTenantId(req)]
    );
    const maxVal = Math.max(subMax.mx || 0, leadMax.mx || 0);
    const newNext = maxVal >= 10000 ? maxVal + 1 : 10001;
    await conn.query(
      'UPDATE client_code_counter SET next_value = ? WHERE id = 1 AND next_value < ?',
      [newNext, newNext]
    );
    await conn.commit();
    const [[counterRow]] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1');
    res.json({ ok: true, maxExisting: maxVal, counterNow: counterRow.next_value });
  } catch (e) {
    await conn.rollback();
    routeError(res, e);
  } finally { conn.release(); }
});

router.post('/api/admin/client-code', requireAuth, requireAdmin, async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
    const next = rows[0]?.next_value ?? 10001;
    await conn.query('UPDATE client_code_counter SET next_value=? WHERE id=1', [next + 1]);
    await conn.commit();
    res.json({ ok: true, code: `C${next}` });
  } catch (e) {
    await conn.rollback();
    routeError(res, e);
  } finally { conn.release(); }
});

module.exports = router;
