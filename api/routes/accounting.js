'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');
const { safeDateOnly, monthRange } = require('../lib/dates');
const { sanitize } = require('../lib/helpers');
const { isBranch, normalizeBranch } = require('../constants/branches');
const { logFinancialAudit } = require('../lib/finance');
const { resolveFinancialScope } = require('../lib/financialScope');

// ─────────────────────────────────────────────────────────────────────────────

// Public: register to waitlist
router.post('/api/waitlist', publicLimiter, async (req, res) => {
  try {
    const { name, phone, email, courseId, courseName, notes, branch } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: 'الاسم والهاتف مطلوبان' });
    const { sanitize } = require('../lib/helpers');
    const safeName   = sanitize(name,  200);
    const safePhone  = sanitize(phone, 50);
    const safeEmail  = sanitize(email || '', 200) || null;
    const safeCourse = sanitize(courseName || '', 200) || null;
    const safeNotes  = sanitize(notes || '', 1000) || null;
    const branchVal  = isBranch(branch) ? normalizeBranch(branch) : 'DAQQI';
    const { uuidv4 } = require('../lib/id');
    const id = uuidv4();
    await pool.query(
      `INSERT INTO daqqi_waitlist (id, tenant_id, name, phone, email, course_id, course_name, notes, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.tenantId, safeName, safePhone, safeEmail, courseId || null, safeCourse, safeNotes, branchVal]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[waitlist]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: list waitlist
router.get('/api/admin/waitlist', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), async (req, res) => {
  try {
    const branch = req.query.branch || '';
    const status = req.query.status || '';
    let sql = 'SELECT * FROM daqqi_waitlist WHERE tenant_id=?';
    const params = [req.tenantId];
    if (branch) { sql += ' AND branch=?'; params.push(branch); }
    if (status) { sql += ' AND status=?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { logger.error('[waitlist]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: update waitlist entry status
router.patch('/api/admin/waitlist/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body || {};
    const allowed = ['waiting','contacted','enrolled','converted','cancelled'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const sets = [];
    const params = [];
    if (status) { sets.push('status=?'); params.push(status); }
    if (notes !== undefined) { sets.push('notes=?'); params.push(notes); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(id, req.tenantId);
    const [r] = await pool.query(`UPDATE daqqi_waitlist SET ${sets.join(', ')} WHERE id=? AND tenant_id=?`, params);
    if (!r.affectedRows) return res.status(404).json({ error: 'Waitlist entry not found' });
    res.json({ ok: true });
  } catch (e) { logger.error('[waitlist]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ── Accounting Periods (Period Closing) ──────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

router.get('/api/admin/accounting-periods', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM accounting_periods WHERE tenant_id=? ORDER BY opened_at DESC LIMIT 100', [req.tenantId]);
    res.json(rows);
  } catch (e) {
    logger.error('[periods]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

router.post('/api/admin/accounting-periods', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const scope = resolveFinancialScope(req);
    if (scope.kind !== 'all' || scope.branchId) {
      return res.status(403).json({ error: 'Accounting period changes require central financial scope' });
    }
    // Ensure no other open period exists
    const label = req.body.label || new Date().toISOString().slice(0, 7); // YYYY-MM
    if (!monthRange(label)) return res.status(400).json({ error: 'Period label must use YYYY-MM' });
    const id = uuidv4();
    await conn.beginTransaction();
    transactionStarted = true;
    const [[existing]] = await conn.query(
      "SELECT id FROM accounting_periods WHERE tenant_id=? AND status='open' LIMIT 1 FOR UPDATE",
      [req.tenantId],
    );
    if (existing) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'يوجد فترة مفتوحة بالفعل. أغلقها أولاً.' });
    }
    await conn.query(
      `INSERT INTO accounting_periods (id, tenant_id, period_label, status) VALUES (?, ?, ?, 'open')`,
      [id, req.tenantId, label]
    );
    await logFinancialAudit({
      entityType: 'period', entityId: id, action: 'create',
      newData: { period_label: label, status: 'open' },
      actor: req.user?.email || req.user?.name || 'admin',
      tenantId: req.tenantId, db: conn, strict: true,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, id });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'يوجد تعارض مع فترة مفتوحة أو مكررة' });
    logger.error('[periods]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  } finally { conn.release(); }
});

router.post('/api/admin/accounting-periods/:id/close', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { id } = req.params;
    const scope = resolveFinancialScope(req);
    if (scope.kind !== 'all' || scope.branchId) {
      return res.status(403).json({ error: 'Accounting period closing requires central financial scope' });
    }
    const actor = req.user?.email || req.user?.name || 'admin';
    await conn.beginTransaction();
    transactionStarted = true;
    // Build a revenue snapshot from payments table
    const [[period]] = await conn.query('SELECT * FROM accounting_periods WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE', [req.tenantId, id]);
    if (!period) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Period not found' });
    }
    if (period.status === 'closed') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Already closed' });
    }
    const [[closeRequest]] = await conn.query(
      `SELECT id,requested_by,reviewed_by FROM accounting_close_requests
        WHERE tenant_id=? AND period_id=? AND status='approved'
        ORDER BY reviewed_at DESC LIMIT 1 FOR UPDATE`,
      [req.tenantId, period.id]
    );
    if (!closeRequest) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({
        error: 'An approved close request is required before closing the period',
        code: 'PERIOD_CLOSE_APPROVAL_REQUIRED',
      });
    }
    const closeActor = String(req.staffRecord?.id || actor);
    if ([closeRequest.requested_by, closeRequest.reviewed_by].map(String).includes(closeActor)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({
        error: 'The close requester or reviewer cannot execute the final close',
        code: 'PERIOD_CLOSE_SOD',
      });
    }
    // Pure, tested half-open range [startDate, endDate) — no DB round-trip.
    const range = monthRange(period.period_label);
    if (!range) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'تنسيق الفترة غير صالح (متوقع YYYY-MM)' });
    }
    const { startDate, endDate } = range;
    const [[integrity]] = await conn.query(
      `SELECT
         (SELECT COUNT(*) FROM payments p
           WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL
             AND p.date>=? AND p.date<?
             AND NOT EXISTS (
               SELECT 1 FROM journal_entries je
                WHERE je.tenant_id=p.tenant_id AND je.ref_type='payment' AND je.ref_id=p.id
             )) AS paid_without_journal,
         (SELECT COUNT(*) FROM (
            SELECT je.id
              FROM journal_entries je
              JOIN journal_entry_lines jel ON jel.entry_id=je.id
             WHERE je.tenant_id=? AND je.entry_date>=? AND je.entry_date<?
             GROUP BY je.id,je.total_debit,je.total_credit
            HAVING ABS(SUM(jel.debit)-SUM(jel.credit))>=0.01
                OR ABS(je.total_debit-je.total_credit)>=0.01
          ) broken) AS unbalanced_journals,
         (SELECT COUNT(*) FROM expenses e
           WHERE e.tenant_id=? AND e.deleted_at IS NULL
             AND e.date>=? AND e.date<?
             AND NOT EXISTS (
               SELECT 1 FROM journal_entries je
                WHERE je.tenant_id=e.tenant_id AND je.ref_type='expense' AND je.ref_id=e.id
             )) AS expenses_without_journal,
         (SELECT COUNT(*) FROM payments p
           WHERE p.tenant_id=? AND p.status='refunded' AND p.deleted_at IS NULL
             AND p.date>=? AND p.date<?
             AND NOT EXISTS (
               SELECT 1 FROM journal_entries je
                WHERE je.tenant_id=p.tenant_id AND je.ref_type='refund' AND je.ref_id=p.id
             )) AS refunds_without_journal,
         (SELECT COUNT(*) FROM payroll_runs pr
           WHERE pr.tenant_id=? AND pr.status='PAID'
             AND pr.year=? AND pr.month=?
             AND NOT EXISTS (
               SELECT 1 FROM journal_entries je
                WHERE je.tenant_id=pr.tenant_id AND je.ref_type='payroll' AND je.ref_id=pr.id
             )) AS payroll_without_journal,
         (SELECT COUNT(*) FROM payments p
           WHERE p.tenant_id=? AND p.status='pending' AND p.deleted_at IS NULL
             AND p.date>=? AND p.date<?) AS pending_payments,
         (SELECT COUNT(*) FROM finance_outbox fo
           WHERE fo.tenant_id=? AND fo.status IN ('failed','dead')) AS failed_finance_events`,
      [
        req.tenantId, startDate, endDate,
        req.tenantId, startDate, endDate,
        req.tenantId, startDate, endDate,
        req.tenantId, startDate, endDate,
        req.tenantId, Number(period.period_label.slice(0, 4)), Number(period.period_label.slice(5, 7)),
        req.tenantId, startDate, endDate,
        req.tenantId,
      ]
    );
    const integrityFailures = Object.fromEntries(
      Object.entries(integrity).filter(([, value]) => Number(value) > 0)
    );
    if (Object.keys(integrityFailures).length) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(409).json({
        error: 'Period cannot close while financial reconciliation has critical errors',
        integrity: integrityFailures,
      });
    }
    const [ledgerSummary] = await conn.query(
      `SELECT LEFT(jel.account_code,1) AS account_class,
              SUM(jel.debit) AS debit, SUM(jel.credit) AS credit, COUNT(DISTINCT je.id) AS entries
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.entry_id=je.id
        WHERE je.tenant_id=? AND je.entry_date>=? AND je.entry_date<?
        GROUP BY LEFT(jel.account_code,1)
        ORDER BY account_class`,
      [req.tenantId, startDate, endDate]
    );
    const summary = {
      ledger: ledgerSummary,
      integrity,
      closedBy: actor,
      closedAt: new Date().toISOString(),
    };
    await conn.query(
      `UPDATE accounting_periods SET status='closed', closed_at=NOW(), closed_by=?, summary_json=? WHERE tenant_id=? AND id=?`,
      [actor, JSON.stringify(summary), req.tenantId, id]
    );
    await conn.query(
      `UPDATE accounting_close_requests
          SET status='consumed',consumed_at=NOW()
        WHERE id=? AND tenant_id=? AND status='approved'`,
      [closeRequest.id, req.tenantId]
    );
    await logFinancialAudit({
      entityType: 'period', entityId: id, action: 'close',
      newData: { period_label: period.period_label }, actor, tenantId: req.tenantId,
      db: conn, strict: true,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, summary });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[periods]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  } finally { conn.release(); }
});

router.post('/api/admin/accounting-periods/:id/reopen', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { id } = req.params;
    const scope = resolveFinancialScope(req);
    if (scope.kind !== 'all' || scope.branchId) {
      return res.status(403).json({ error: 'Accounting period reopening requires central financial scope' });
    }
    const actor = req.user?.email || req.user?.name || 'admin';
    const reason = sanitize(req.body?.reason || '', 500);
    if (!reason) return res.status(400).json({ error: 'A reason is required to reopen a closed period' });
    await conn.beginTransaction();
    transactionStarted = true;
    const [result] = await conn.query(
      `UPDATE accounting_periods SET status='open', closed_at=NULL, closed_by=NULL
        WHERE tenant_id=? AND id=? AND status='closed'`,
      [req.tenantId, id]
    );
    if (!result.affectedRows) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Period not found' });
    }
    await logFinancialAudit({
      entityType: 'period', entityId: id, action: 'reopen',
      newData: { reason }, actor, tenantId: req.tenantId, db: conn, strict: true,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[periods]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  } finally { conn.release(); }
});


module.exports = router;
