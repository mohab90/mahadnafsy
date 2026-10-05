'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { sendWhatsApp } = require('../lib/whatsapp');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');
const { resolveFinancialScope } = require('../lib/financialScope');
const { logPaymentAudit } = require('../lib/finance');
const { loadOutstandingBalances } = require('../lib/outstandingBalances');

router.get('/api/admin/payments/outstanding', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null, allowAssigned: true });
    const rows = await loadOutstandingBalances(tenantId, null, scope);
    res.json({ subscribers: rows, total_outstanding: rows.reduce((sum, row) => sum + (Number(row.outstanding) || 0), 0), count: rows.length });
  } catch (error) {
    logger.error('[outstanding-payments]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/payments/send-reminder', requireAuth, requireAdminOrStaff, requirePermission('manage_payments'), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const scope = resolveFinancialScope(req, { requestedBranch: req.body?.branch || null, allowAssigned: true });
    const ids = Array.isArray(req.body?.subscriberIds) ? req.body.subscriberIds.slice(0, 200) : [];
    if (!req.body?.all && !ids.length) return res.status(400).json({ error: 'subscriberIds or all=true required' });
    const customMessage = String(req.body?.message || '').trim();
    if (customMessage.length > 1000) return res.status(400).json({ error: 'message is too long' });
    const rows = await loadOutstandingBalances(tenantId, req.body?.all ? null : ids, scope);
    const results = [];
    for (const subscriber of rows) {
      const amount = Number(subscriber.outstanding) || 0;
      const message = customMessage
        ? customMessage.replaceAll('{name}', subscriber.name || '').replaceAll('{amount}', amount.toFixed(0))
        : `أهلاً ${subscriber.name || ''}، لديك رصيد مستحق ${amount.toFixed(0)} ج.م. يرجى التواصل معنا لتسوية الرصيد.`;
      try {
        await sendWhatsApp(String(subscriber.phone || '').replace(/\D/g, ''), message, { tenantId: req.tenantId, category: 'crm' });
        results.push({ id: subscriber.id, ok: true });
      } catch (error) { results.push({ id: subscriber.id, ok: false }); }
    }
    res.json({ ok: true, sent: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length, results });
  } catch (error) {
    logger.error('[payment-reminders]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/payments/bulk-stub', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), bulkOperationLimiter, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const scope = resolveFinancialScope(req, { requestedBranch: req.body?.branch || null });
    const branchSql = scope.branchId ? ' AND e.branch_id=?' : '';
    const [rows] = await pool.query(
      `SELECT e.id, e.subscriber_id, e.course_id, e.bundle_id, e.enrolled_at, e.branch_id
         FROM enrollments e
        WHERE e.tenant_id=? AND e.status='active' AND NOT EXISTS (
          SELECT 1 FROM payments p WHERE p.tenant_id=e.tenant_id AND p.subscriber_id=e.subscriber_id
            AND (p.course_id=e.course_id OR (e.course_id IS NULL AND p.bundle_id=e.bundle_id))
          -- Deleted payments count: this list is what bulk-stub writes a
          -- placeholder payment for, and re-creating a row an admin chose
          -- to delete is not reconciliation.
        )${branchSql} LIMIT 1000`,
      scope.branchId ? [tenantId, scope.branchId] : [tenantId]
    );
    if (req.body?.dryRun !== false) return res.json({ dryRun: true, count: rows.length, sample: rows.slice(0, 5) });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const row of rows) {
        const stubId = uuidv4();
        await conn.query(
          `INSERT INTO payments
             (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
              payment_method, date, note, status, source, tenant_id, branch_id, created_at)
           VALUES (?,?,?,?,0,'EGP','OTHER','historical',?,'تسجيل تاريخي بدون إثبات دفع','pending','reconciliation_stub',?,?,NOW())`,
          [stubId, row.subscriber_id, row.course_id || null, row.bundle_id || null,
           row.enrolled_at, tenantId, row.branch_id || 'branch-other']
        );
        // A zero-amount pending stub is outside paid_without_audit's scope, but
        // the rule is every payments row leaves a trail, not every row the alert
        // happens to look at. A stub that appears with no provenance is exactly
        // the kind of row someone later has to guess about.
        await logPaymentAudit(stubId, 'create', null, 'pending', 0, row.subscriber_id,
          req.user?.email || 'reconciliation-stub', tenantId, conn, true);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally { conn.release(); }
    res.json({ ok: true, created: rows.length });
  } catch (error) {
    logger.error('[payment-stubs]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
