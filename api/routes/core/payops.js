'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { pool } = require('../../lib/db');
const { tryJson } = require('../../lib/helpers');
const { postPaymentJournal } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');
const { retryFinanceEvent } = require('../../lib/financeOutbox');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');

router.post('/api/admin/backfill-payments', requireAuth, requireAdmin, async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'confirm=true required' });
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const [subscribers] = await conn.query(
      'SELECT id, branch, branch_id, crm_json FROM subscribers WHERE tenant_id=? AND crm_json IS NOT NULL LIMIT 5000',
      [tenantId]
    );
    await conn.beginTransaction();
    transactionStarted = true;
    let inserted = 0;
    let skipped = 0;
    const validTypes = new Set(['COURSE', 'BUNDLE', 'CERTIFICATE', 'CONSULTATION', 'BOOK', 'CARNEH', 'OTHER']);
    for (const subscriber of subscribers) {
      const history = tryJson(subscriber.crm_json, {}).paymentHistory || [];
      for (const item of Array.isArray(history) ? history : []) {
        const amount = Number(item.amount) || 0;
        if (!item.id || amount <= 0) { skipped += 1; continue; }
        const [[exists]] = await conn.query('SELECT id FROM payments WHERE id=? AND tenant_id=? LIMIT 1', [item.id, tenantId]);
        if (exists) { skipped += 1; continue; }
        const paymentType = validTypes.has(String(item.paymentType || '').toUpperCase())
          ? String(item.paymentType).toUpperCase() : 'OTHER';
        const date = String(item.at || item.date || new Date().toISOString()).slice(0, 10);
        await assertWritable(date, conn, tenantId);
        await conn.query(
          `INSERT INTO payments
             (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
              payment_method, transaction_id, is_installment, date, note, status,
              tenant_id, branch, branch_id, source, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'paid',?,?,?,?,NOW())`,
          [item.id, subscriber.id, item.courseId || null, item.bundleId || null, amount,
           item.currency || 'EGP', paymentType, item.paymentMethod || 'historical',
           item.transactionId || null, item.isInstallment ? 1 : 0, date, item.note || null,
           tenantId, subscriber.branch || 'ONLINE_EGYPT', subscriber.branch_id || 'branch-other', 'crm_backfill']
        );
        const journalId = await postPaymentJournal({
          paymentId: item.id, amount, currency: item.currency || 'EGP', payType: paymentType,
          date, actor: req.user?.email || 'backfill', tenantId,
        }, conn);
        if (!journalId) throw new Error(`Journal failed for ${item.id}`);
        inserted += 1;
      }
    }
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, inserted, skipped });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[backfill-payments]', error.message);
    res.status(500).json({ error: 'Backfill rolled back' });
  } finally { conn.release(); }
});

router.get('/api/admin/reconcile-payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const [unpaid] = await pool.query(
      `SELECT e.id AS enrollment_id, s.name, s.email, s.client_code, s.branch,
              c.title AS course_title, e.enrolled_at
         FROM enrollments e
         JOIN subscribers s ON s.id=e.subscriber_id AND s.tenant_id=e.tenant_id
         LEFT JOIN courses c ON c.id=e.course_id AND c.tenant_id=e.tenant_id
        WHERE e.tenant_id=? AND NOT EXISTS (
          SELECT 1 FROM payments p
           WHERE p.subscriber_id=e.subscriber_id AND p.tenant_id=e.tenant_id
             AND p.status='paid' AND p.deleted_at IS NULL
             AND (p.course_id=e.course_id OR EXISTS (
               SELECT 1 FROM bundle_courses bc WHERE bc.bundle_id=p.bundle_id AND bc.course_id=e.course_id
             ))
        ) ORDER BY e.enrolled_at DESC LIMIT 500`,
      [tenantId]
    );
    const [[totals]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM enrollments WHERE tenant_id=?) AS total_enrollments,
        (SELECT COUNT(*) FROM payments WHERE tenant_id=? AND deleted_at IS NULL) AS total_payments`,
      [tenantId, tenantId]
    );
    res.json({ summary: { ...totals, unpaid_enrollments: unpaid.length }, unpaid });
  } catch (error) {
    logger.error('[reconcile-payments]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/reconciliation-dashboard', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const checks = [
      {
        key: 'paid_without_journal', severity: 'critical',
        sql: `SELECT p.id,p.subscriber_id,p.amount,p.currency,p.date
                FROM payments p
                LEFT JOIN journal_entries je ON je.tenant_id=p.tenant_id AND je.ref_type='payment' AND je.ref_id=p.id
               WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND je.id IS NULL
               ORDER BY p.date DESC LIMIT 100`,
      },
      {
        key: 'unbalanced_journal', severity: 'critical',
        sql: `SELECT id,entry_date,ref_type,ref_id,total_debit,total_credit
                FROM journal_entries
               WHERE tenant_id=? AND ABS(COALESCE(total_debit,0)-COALESCE(total_credit,0)) >= 0.01
               ORDER BY entry_date DESC LIMIT 100`,
      },
      {
        key: 'paid_without_enrollment', severity: 'critical',
        sql: `SELECT p.id,p.subscriber_id,p.course_id,p.bundle_id,p.amount,p.date
                FROM payments p
               WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL
                 AND (p.course_id IS NOT NULL OR p.bundle_id IS NOT NULL)
                 AND NOT EXISTS (
                   SELECT 1 FROM enrollments e
                    WHERE e.tenant_id=p.tenant_id AND e.subscriber_id=p.subscriber_id
                      AND (e.course_id=p.course_id OR (p.bundle_id IS NOT NULL AND e.bundle_id=p.bundle_id))
                 )
               ORDER BY p.date DESC LIMIT 100`,
      },
      {
        key: 'converted_without_subscriber', severity: 'critical',
        sql: `SELECT l.id,l.name,l.email,l.phone,l.updated_at
                FROM leads l
               WHERE l.tenant_id=? AND l.hidden=0 AND LOWER(l.status)='converted'
                 AND NOT EXISTS (
                   SELECT 1 FROM subscribers s WHERE s.tenant_id=l.tenant_id
                     AND (s.lead_id=l.id OR (l.email<>'' AND LOWER(TRIM(s.email))=LOWER(TRIM(l.email))) OR (l.phone<>'' AND s.phone=l.phone))
                 )
               ORDER BY l.updated_at DESC LIMIT 100`,
      },
      {
        key: 'paid_order_without_payment', severity: 'critical',
        sql: `SELECT o.id,o.type,o.item_title,o.amount,o.currency,o.transaction_id,o.paid_at
                FROM orders o
               WHERE o.tenant_id=? AND o.status='PAID' AND o.deleted_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM payments p WHERE p.tenant_id=o.tenant_id AND p.deleted_at IS NULL
                     AND (p.id=o.id OR (o.transaction_id IS NOT NULL AND p.transaction_id=o.transaction_id))
                 )
               ORDER BY o.paid_at DESC LIMIT 100`,
      },
      {
        key: 'dead_customer_messages', severity: 'warning',
        sql: `SELECT id,channel,subject,status,attempts,last_error,created_at
                FROM message_outbox WHERE tenant_id=? AND status IN ('failed','dead')
               ORDER BY created_at DESC LIMIT 100`,
      },
      {
        key: 'failed_finance_events', severity: 'critical',
        sql: `SELECT id,event_type,ref_type,ref_id,status,attempts,error_message,created_at
                FROM finance_outbox
               WHERE tenant_id=? AND status IN ('failed','dead')
               ORDER BY created_at DESC LIMIT 100`,
      },
    ];
    const results = await Promise.all(checks.map(async check => {
      const [rows] = await pool.query(check.sql, [tenantId]);
      return { key: check.key, severity: check.severity, count: rows.length, rows };
    }));
    const criticalCount = results.filter(result => result.severity === 'critical').reduce((sum, result) => sum + result.count, 0);
    res.json({ ok: criticalCount === 0, tenantId, criticalCount, checks: results, checkedAt: new Date().toISOString() });
  } catch (error) {
    logger.error('[reconciliation-dashboard]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/finance-outbox', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const allowedStatuses = new Set(['pending', 'processing', 'processed', 'failed', 'dead']);
    const status = allowedStatuses.has(String(req.query.status || '')) ? String(req.query.status) : null;
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit || '50', 10)));
    const params = [req.tenantId];
    const statusSql = status ? ' AND status=?' : '';
    if (status) params.push(status);
    const [rows] = await pool.query(
      `SELECT id,event_type,ref_type,ref_id,dedupe_key,status,attempts,error_message,next_attempt_at,created_at,updated_at
         FROM finance_outbox WHERE tenant_id=?${statusSql}
        ORDER BY created_at DESC LIMIT ?`,
      [...params, limit]
    );
    res.json({ rows, status, tenantId: req.tenantId });
  } catch (error) {
    logger.error('[finance-outbox-list]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/finance-outbox/:id/retry', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const retried = await retryFinanceEvent(req.params.id, req.tenantId);
    if (!retried) return res.status(404).json({ error: 'Failed finance event not found' });
    res.json({ ok: true, id: req.params.id });
  } catch (error) {
    logger.error('[finance-outbox-retry]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/payment-audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;
    const params = [tenantId];
    let filters = '';
    if (req.query.paymentId) { filters += ' AND a.payment_id=?'; params.push(req.query.paymentId); }
    if (req.query.action) { filters += ' AND a.action=?'; params.push(req.query.action); }
    const [[count]] = await pool.query(
      `SELECT COUNT(*) AS total FROM payment_audit_log a JOIN payments p ON p.id=a.payment_id AND p.tenant_id=? WHERE 1=1${filters}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT a.*, s.name AS subscriber_name, s.client_code
         FROM payment_audit_log a
         JOIN payments p ON p.id=a.payment_id AND p.tenant_id=?
         LEFT JOIN subscribers s ON s.id=a.subscriber_id AND s.tenant_id=p.tenant_id
        WHERE 1=1${filters} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ total: Number(count.total) || 0, page, limit, rows });
  } catch (error) {
    logger.error('[payment-audit]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
