'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { pool } = require('../../lib/db');
const { tryJson } = require('../../lib/helpers');
const { postPaymentJournal } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');
const { retryFinanceEvent } = require('../../lib/financeOutbox');
const { resolveFinancialScope } = require('../../lib/financialScope');
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
    // Batched existence check (PERF-05): this used to run one SELECT per history item
    // inside the double loop below — up to thousands of sequential queries for a
    // single backfill run. Collecting every candidate id up front and checking them
    // in one IN(...) query removes that hotspot; the INSERT + journal-posting per
    // item still has to stay per-row since each carries its own accounting entry.
    const allItemIds = [];
    for (const subscriber of subscribers) {
      const history = tryJson(subscriber.crm_json, {}).paymentHistory || [];
      for (const item of Array.isArray(history) ? history : []) {
        if (item?.id) allItemIds.push(item.id);
      }
    }
    const existingIds = new Set();
    if (allItemIds.length) {
      const [existingRows] = await conn.query(
        `SELECT id FROM payments WHERE tenant_id=? AND id IN (${allItemIds.map(() => '?').join(',')})`,
        [tenantId, ...allItemIds]
      );
      for (const row of existingRows) existingIds.add(row.id);
    }

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
        if (existingIds.has(item.id)) { skipped += 1; continue; }
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
         JOIN subscribers s ON s.id=e.subscriber_id AND s.tenant_id=e.tenant_id AND s.deleted_at IS NULL
         LEFT JOIN courses c ON c.id=e.course_id AND c.tenant_id=e.tenant_id AND c.deleted_at IS NULL
        WHERE e.tenant_id=? AND e.status='active' AND NOT EXISTS (
          SELECT 1 FROM payments p
           WHERE p.subscriber_id=e.subscriber_id AND p.tenant_id=e.tenant_id
             AND p.status='paid' AND p.deleted_at IS NULL
             AND (p.course_id=e.course_id OR EXISTS (
                SELECT 1 FROM bundle_courses bc
                 WHERE bc.bundle_id=p.bundle_id AND bc.course_id=e.course_id AND bc.tenant_id=e.tenant_id
             ))
        ) ORDER BY e.enrolled_at DESC LIMIT 500`,
      [tenantId]
    );
    const [[totals]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM enrollments WHERE tenant_id=? AND status='active') AS total_enrollments,
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
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchParams = scope.branchId ? [tenantId, scope.branchId] : [tenantId];
    const paymentBranchSql = scope.branchId ? ' AND p.branch_id=?' : '';
    const journalBranchSql = scope.branchId ? ' AND je.branch_id=?' : '';
    const leadBranchSql = scope.branchId ? ' AND l.branch_id=?' : '';
    const orderBranchSql = scope.branchId ? ' AND o.branch_id=?' : '';
    const proofBranchSql = scope.branchId ? ' AND pp.branch_id=?' : '';
    const checks = [
      {
        key: 'paid_without_journal', severity: 'critical',
        sql: `SELECT p.id,p.subscriber_id,p.amount,p.currency,p.date
                FROM payments p
                LEFT JOIN journal_entries je ON je.tenant_id=p.tenant_id AND je.ref_type='payment' AND je.ref_id=p.id
               WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND je.id IS NULL${paymentBranchSql}
               ORDER BY p.date DESC LIMIT 100`,
      },
      {
        key: 'payment_without_invoice', severity: 'critical',
        sql: `SELECT p.id,p.subscriber_id,p.amount,p.currency,p.date
                FROM payments p
               WHERE p.tenant_id=? AND p.status IN ('paid','refunded') AND p.deleted_at IS NULL${paymentBranchSql}
                 AND NOT EXISTS (
                   SELECT 1 FROM financial_documents fd
                    WHERE fd.tenant_id=p.tenant_id AND fd.document_type='invoice'
                      AND fd.source_type='payment' AND fd.source_id=p.id
                 )
               ORDER BY p.date DESC LIMIT 100`,
      },
      {
        key: 'refund_without_credit_note', severity: 'critical',
        sql: `SELECT p.id,p.subscriber_id,p.amount,p.currency,p.date
                FROM payments p
               WHERE p.tenant_id=? AND p.status='refunded' AND p.deleted_at IS NULL${paymentBranchSql}
                 AND NOT EXISTS (
                   SELECT 1 FROM financial_documents cn
                   JOIN financial_documents inv
                     ON inv.id=cn.related_document_id AND inv.tenant_id=cn.tenant_id
                    WHERE cn.tenant_id=p.tenant_id AND cn.document_type='credit_note'
                      AND cn.source_type='payment_refund' AND cn.source_id=p.id
                      AND inv.document_type='invoice' AND inv.source_type='payment' AND inv.source_id=p.id
                 )
               ORDER BY p.date DESC LIMIT 100`,
      },
      {
        key: 'unbalanced_journal', severity: 'critical',
        sql: `SELECT je.id,je.entry_date,je.ref_type,je.ref_id,je.total_debit,je.total_credit
                 FROM journal_entries je
                 JOIN journal_entry_lines jel ON jel.entry_id=je.id
                WHERE je.tenant_id=?${journalBranchSql}
                GROUP BY je.id,je.entry_date,je.ref_type,je.ref_id,je.total_debit,je.total_credit
               HAVING ABS(COALESCE(je.total_debit,0)-COALESCE(je.total_credit,0))>=0.01
                   OR ABS(SUM(jel.debit)-SUM(jel.credit))>=0.01
                   OR ABS(COALESCE(je.total_debit,0)-SUM(jel.debit))>=0.01
                ORDER BY je.entry_date DESC LIMIT 100`,
      },
      {
        key: 'paid_without_fx_snapshot', severity: 'critical',
        sql: `SELECT p.id,p.amount,p.currency,p.amount_egp,p.fx_rate_to_egp,p.fx_source,p.date
                FROM payments p
               WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL
                 AND p.amount>0 AND (p.amount_egp IS NULL OR p.amount_egp<=0
                   OR p.fx_rate_to_egp IS NULL OR p.fx_rate_to_egp<=0)${paymentBranchSql}
               ORDER BY p.date DESC LIMIT 100`,
      },
      {
        key: 'payment_ledger_amount_mismatch', severity: 'critical',
        sql: `SELECT p.id,p.amount_egp,p.currency,p.date,je.total_debit,je.total_credit
                FROM payments p
                JOIN journal_entries je ON je.tenant_id=p.tenant_id
                 AND je.ref_type='payment' AND je.ref_id=p.id
               WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL
                 AND (ABS(COALESCE(je.total_debit,0)-COALESCE(p.amount_egp,0))>=0.01
                   OR ABS(COALESCE(je.total_debit,0)-COALESCE(je.total_credit,0))>=0.01)${paymentBranchSql}
               ORDER BY p.date DESC LIMIT 100`,
      },
      {
        key: 'paid_without_enrollment', severity: 'critical',
        sql: `SELECT p.id,p.subscriber_id,p.course_id,p.bundle_id,p.amount,p.date
                FROM payments p
               WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL${paymentBranchSql}
                 AND (p.course_id IS NOT NULL OR p.bundle_id IS NOT NULL)
                 AND NOT EXISTS (
                   SELECT 1 FROM enrollments e
                    WHERE e.tenant_id=p.tenant_id AND e.subscriber_id=p.subscriber_id AND e.status='active'
                       AND (
                         e.course_id=p.course_id
                         OR (p.bundle_id IS NOT NULL AND e.bundle_id=p.bundle_id)
                         OR (p.bundle_id IS NOT NULL AND EXISTS (
                           SELECT 1 FROM bundle_courses bc
                            WHERE bc.tenant_id=e.tenant_id AND bc.bundle_id=p.bundle_id AND bc.course_id=e.course_id
                         ))
                       )
                 )
               ORDER BY p.date DESC LIMIT 100`,
      },
      {
        key: 'converted_without_subscriber', severity: 'critical',
        sql: `SELECT l.id,l.name,l.email,l.phone,l.updated_at
                FROM leads l
               WHERE l.tenant_id=? AND l.hidden=0 AND l.status='converted'${leadBranchSql}
                 AND NOT EXISTS (
                    SELECT 1 FROM subscribers s WHERE s.tenant_id=l.tenant_id AND s.deleted_at IS NULL
                     AND (s.lead_id=l.id OR (l.email<>'' AND LOWER(TRIM(s.email))=LOWER(TRIM(l.email))) OR (l.phone<>'' AND s.phone=l.phone))
                 )
               ORDER BY l.updated_at DESC LIMIT 100`,
      },
      {
        key: 'paid_order_without_payment', severity: 'critical',
        sql: `SELECT o.id,o.type,o.item_title,o.amount,o.currency,o.transaction_id,o.paid_at
                FROM orders o
               WHERE o.tenant_id=? AND o.status='paid' AND o.deleted_at IS NULL${orderBranchSql}
                 AND NOT EXISTS (
                    SELECT 1 FROM payments p WHERE p.tenant_id=o.tenant_id AND p.deleted_at IS NULL AND p.status='paid'
                     AND (p.id=o.id OR (o.transaction_id IS NOT NULL AND p.transaction_id=o.transaction_id))
                 )
               ORDER BY o.paid_at DESC LIMIT 100`,
      },
      {
        key: 'approved_proof_without_payment', severity: 'critical',
        sql: `SELECT pp.id,pp.order_id,pp.subscriber_id,pp.amount,pp.currency,pp.reviewed_at
                FROM payment_proofs pp
               WHERE pp.tenant_id=? AND pp.status='APPROVED'${proofBranchSql}
                 AND NOT EXISTS (
                   SELECT 1 FROM payments p
                    WHERE p.tenant_id=pp.tenant_id AND p.deleted_at IS NULL
                      AND p.status='paid' AND (p.id=CONCAT('proof-',pp.id) OR p.transaction_id=pp.id)
                 )
               ORDER BY pp.reviewed_at DESC LIMIT 100`,
      },
      {
        key: 'paid_without_audit', severity: 'critical',
        sql: `SELECT p.id,p.subscriber_id,p.amount,p.currency,p.date
                FROM payments p
               WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL${paymentBranchSql}
                 AND NOT EXISTS (
                   SELECT 1 FROM payment_audit_log pal
                    WHERE pal.tenant_id=p.tenant_id AND pal.payment_id=p.id
                 )
               ORDER BY p.date DESC LIMIT 100`,
      },
      {
        key: 'commission_missing', severity: 'critical',
        sql: `SELECT p.id,p.subscriber_id,p.amount_egp,p.date,s.assigned_sales_id
                FROM payments p
                JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
                JOIN staff st ON st.id=s.assigned_sales_id AND st.tenant_id=p.tenant_id
               WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL
                 AND COALESCE(st.commission_rate,0)>0${paymentBranchSql}
                 AND NOT EXISTS (
                   SELECT 1 FROM crm_commissions cc
                    WHERE cc.tenant_id=p.tenant_id AND cc.payment_id=p.id
                      AND cc.staff_id=s.assigned_sales_id
                 )
               ORDER BY p.date DESC LIMIT 100`,
      },
      {
        key: 'instructor_fee_missing', severity: 'critical',
        sql: `SELECT p.id,p.course_id,p.amount_egp,p.date,c.instructor_id,ir.revenue_share_pct
                FROM payments p
                JOIN courses c ON c.id=p.course_id AND c.tenant_id=p.tenant_id
                JOIN instructor_rates ir ON ir.staff_id=c.instructor_id AND ir.tenant_id=p.tenant_id
               WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL
                 AND p.payment_type='COURSE' AND ir.revenue_share_pct>0${paymentBranchSql}
                 AND NOT EXISTS (
                   SELECT 1 FROM instructor_fees f
                    WHERE f.tenant_id=p.tenant_id AND f.source_payment_id=p.id
                 )
               ORDER BY p.date DESC LIMIT 100`,
      },
      {
        key: 'dead_customer_messages', severity: 'warning',
        centralOnly: true,
        sql: `SELECT id,channel,subject,status,attempts,last_error,created_at
                FROM message_outbox WHERE tenant_id=? AND status IN ('failed','dead')
               ORDER BY created_at DESC LIMIT 100`,
      },
      {
        key: 'failed_finance_events', severity: 'critical',
        centralOnly: true,
        sql: `SELECT id,event_type,ref_type,ref_id,status,attempts,error_message,created_at
                FROM finance_outbox
               WHERE tenant_id=? AND status IN ('failed','dead')
               ORDER BY created_at DESC LIMIT 100`,
      },
    ].filter(check => !check.centralOnly || (!scope.branchId && scope.kind === 'all'));
    const results = await Promise.all(checks.map(async check => {
      const [rows] = await pool.query(check.sql, check.centralOnly ? [tenantId] : branchParams);
      return { key: check.key, severity: check.severity, count: rows.length, rows };
    }));
    const criticalCount = results.filter(result => result.severity === 'critical').reduce((sum, result) => sum + result.count, 0);
    res.json({
      ok: criticalCount === 0,
      tenantId,
      branch: scope.branch,
      branchId: scope.branchId,
      criticalCount,
      checks: results,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[reconciliation-dashboard]', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error', code: error.code });
  }
});

router.get('/api/admin/finance-outbox', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req);
    if (scope.branchId || scope.kind !== 'all') {
      return res.status(403).json({ error: 'Finance outbox is available to central financial scope only' });
    }
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
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error', code: error.code });
  }
});

router.post('/api/admin/finance-outbox/:id/retry', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req);
    if (scope.branchId || scope.kind !== 'all') {
      return res.status(403).json({ error: 'Finance outbox retry is available to central financial scope only' });
    }
    const retried = await retryFinanceEvent(req.params.id, req.tenantId);
    if (!retried) return res.status(404).json({ error: 'Failed finance event not found' });
    res.json({ ok: true, id: req.params.id });
  } catch (error) {
    logger.error('[finance-outbox-retry]', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error', code: error.code });
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
      `SELECT COUNT(*) AS total FROM payment_audit_log a
        JOIN payments p ON p.id=a.payment_id AND p.tenant_id=? AND a.tenant_id=p.tenant_id
       WHERE 1=1${filters}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT a.*, s.name AS subscriber_name, s.client_code
         FROM payment_audit_log a
         JOIN payments p ON p.id=a.payment_id AND p.tenant_id=? AND a.tenant_id=p.tenant_id
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
