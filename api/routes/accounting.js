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
      `INSERT INTO daqqi_waitlist (id, name, phone, email, course_id, course_name, notes, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, safeName, safePhone, safeEmail, courseId || null, safeCourse, safeNotes, branchVal]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[waitlist]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: list waitlist
router.get('/api/admin/waitlist', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const branch = req.query.branch || '';
    const status = req.query.status || '';
    let sql = 'SELECT * FROM daqqi_waitlist WHERE 1=1';
    const params = [];
    if (branch) { sql += ' AND branch=?'; params.push(branch); }
    if (status) { sql += ' AND status=?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { logger.error('[waitlist]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: update waitlist entry status
router.patch('/api/admin/waitlist/:id', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body || {};
    const allowed = ['waiting','contacted','enrolled','cancelled'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const sets = [];
    const params = [];
    if (status) { sets.push('status=?'); params.push(status); }
    if (notes !== undefined) { sets.push('notes=?'); params.push(notes); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(id);
    await pool.query(`UPDATE daqqi_waitlist SET ${sets.join(', ')} WHERE id=?`, params);
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
  } catch (e) { logger.error('[periods]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/accounting-periods', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    // Ensure no other open period exists
    const [[existing]] = await pool.query("SELECT id FROM accounting_periods WHERE tenant_id=? AND status='open' LIMIT 1", [req.tenantId]);
    if (existing) return res.status(409).json({ error: 'يوجد فترة مفتوحة بالفعل. أغلقها أولاً.' });
    const label = req.body.label || new Date().toISOString().slice(0, 7); // YYYY-MM
    const { uuidv4 } = require('../lib/id');
    const id = uuidv4();
    await pool.query(
      `INSERT INTO accounting_periods (id, tenant_id, period_label, status) VALUES (?, ?, ?, 'open')`,
      [id, req.tenantId, label]
    );
    res.json({ ok: true, id });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'يوجد تعارض مع فترة مفتوحة أو مكررة' });
    logger.error('[periods]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/accounting-periods/:id/close', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { id } = req.params;
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
    // Pure, tested half-open range [startDate, endDate) — no DB round-trip.
    const range = monthRange(period.period_label);
    if (!range) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'تنسيق الفترة غير صالح (متوقع YYYY-MM)' });
    }
    const { startDate, endDate } = range;
    // Snapshot revenue by the payment's BUSINESS date (`date`), not `created_at`.
    // A payment collected in month M but entered later must fall in M's period.
    // `date` is also indexed (idx_payments_date) whereas created_at is not.
    const [pmts] = await conn.query(
      `SELECT SUM(amount) AS total, currency, COUNT(*) AS count
       FROM payments WHERE tenant_id=? AND status='paid'
         AND \`date\` >= ? AND \`date\` < ?
       GROUP BY currency`,
      [req.tenantId, startDate, endDate]
    );
    const [exps] = await conn.query(
      `SELECT SUM(amount) AS total, currency FROM expenses
       WHERE tenant_id=? AND deleted_at IS NULL AND date >= ? AND date < ?
       GROUP BY currency`,
      [req.tenantId, startDate, endDate]
    ).catch(() => [[]]);
    const summary = { revenues: pmts, expenses: exps, closedBy: actor, closedAt: new Date().toISOString() };
    await conn.query(
      `UPDATE accounting_periods SET status='closed', closed_at=NOW(), closed_by=?, summary_json=? WHERE tenant_id=? AND id=?`,
      [actor, JSON.stringify(summary), req.tenantId, id]
    );
    await conn.commit();
    transactionStarted = false;
    await logFinancialAudit({ entityType: 'period', entityId: id, action: 'close', newData: { period_label: period.period_label }, actor, tenantId: req.tenantId });
    res.json({ ok: true, summary });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[periods]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

router.post('/api/admin/accounting-periods/:id/reopen', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.user?.email || req.user?.name || 'admin';
    const [result] = await pool.query(
      `UPDATE accounting_periods SET status='open', closed_at=NULL, closed_by=NULL WHERE tenant_id=? AND id=?`,
      [req.tenantId, id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Period not found' });
    await logFinancialAudit({ entityType: 'period', entityId: id, action: 'reopen', actor, tenantId: req.tenantId });
    res.json({ ok: true });
  } catch (e) { logger.error('[periods]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


module.exports = router;
