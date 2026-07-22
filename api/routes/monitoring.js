'use strict';
/**
 * Monitoring dashboard endpoint (Top20 #19). Aggregates process health, DB
 * reachability, and queue/outbox/audit depths into one admin payload so the UI
 * can render a real ops dashboard. Every probe is individually guarded so one
 * missing table never fails the whole response.
 */
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const errorMonitor = require('../lib/errorMonitor');

async function safeCount(sql, params = []) {
  try { const [[r]] = await pool.query(sql, params); return Number(r.n); }
  catch { return null; }
}

async function sumPaidPaymentsEgp(where = '', params = []) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(amount_egp),0) AS total FROM payments WHERE status='paid' ${where}`,
    params
  );
  return Number(row?.total || 0);
}

router.get('/api/admin/monitoring', requireAuth, requireAdmin, async (req, res) => {
  try {
    const mem = process.memoryUsage();
    let dbOk = true;
    const t0 = Date.now();
    try { await pool.query('SELECT 1'); } catch { dbOk = false; }
    const dbLatencyMs = Date.now() - t0;

    const [outboxPending, outboxFailed, outboxDead, jobsPending, jobsFailed, jobsDead, queueJobsPending, queueJobsFailed, auditToday] = await Promise.all([
      safeCount("SELECT COUNT(*) n FROM message_outbox WHERE tenant_id=? AND status='pending'", [req.tenantId]),
      safeCount("SELECT COUNT(*) n FROM message_outbox WHERE tenant_id=? AND status='failed'", [req.tenantId]),
      safeCount("SELECT COUNT(*) n FROM message_outbox WHERE tenant_id=? AND status='dead'", [req.tenantId]),
      safeCount("SELECT COUNT(*) n FROM job_queue WHERE tenant_id=? AND status='pending'", [req.tenantId]),
      safeCount("SELECT COUNT(*) n FROM job_queue WHERE tenant_id=? AND status IN ('failed','dead')", [req.tenantId]),
      safeCount("SELECT COUNT(*) n FROM job_queue WHERE tenant_id=? AND status='dead'", [req.tenantId]),
      safeCount("SELECT COUNT(*) n FROM queue_jobs WHERE tenant_id=? AND status IN ('pending','processing')", [req.tenantId]),
      safeCount("SELECT COUNT(*) n FROM queue_jobs WHERE tenant_id=? AND status='failed'", [req.tenantId]),
      safeCount('SELECT COUNT(*) n FROM audit_logs WHERE tenant_id=? AND created_at >= CURDATE()', [req.tenantId]),
    ]);

    res.json({
      ts: new Date().toISOString(),
      process: {
        uptimeSec: Math.round(process.uptime()),
        pid: process.pid,
        nodeVersion: process.version,
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
      },
      db: { ok: dbOk, latencyMs: dbLatencyMs },
      outbox: { pending: outboxPending, failed: outboxFailed, dead: outboxDead },
      jobs: { pending: jobsPending, failed: jobsFailed, dead: jobsDead },
      queueJobs: { active: queueJobsPending, failed: queueJobsFailed },
      audit: { eventsToday: auditToday },
      errors: errorMonitor.stats(),
    });
  } catch (e) {
    logger.error('[monitoring]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/audit-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const severity = req.query.severity ? String(req.query.severity) : null;
    const params = [];
    let where = 'WHERE tenant_id = ?';
    params.push(req.tenantId || 'tenant-default');
    if (severity) {
      where += ' AND severity = ?';
      params.push(severity);
    }
    params.push(limit);
    const [rows] = await pool.query(
      `SELECT id, tenant_id, actor_id, actor_role, action, entity_type, entity_id,
              severity, metadata_json, ip_address, user_agent, created_at
         FROM audit_logs ${where}
        ORDER BY created_at DESC
        LIMIT ?`,
      params
    );
    res.json(rows);
  } catch (e) {
    logger.error('[audit-logs]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/queue-dashboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const [jobRows] = await pool.query(
      `SELECT id, tenant_id, job_type AS job_name, status, attempts, max_attempts,
              last_error AS error_message, run_at, locked_at, done_at, created_at, updated_at
         FROM job_queue WHERE tenant_id=?
        ORDER BY created_at DESC
        LIMIT ?`,
      [req.tenantId, limit]
    ).catch(() => [[]]);
    const [queueRows] = await pool.query(
      `SELECT id, tenant_id, queue_name, job_name, status, priority, attempts, max_attempts,
              error_message, run_after, locked_at, completed_at, created_at, updated_at
         FROM queue_jobs WHERE tenant_id=?
        ORDER BY created_at DESC
        LIMIT ?`,
      [req.tenantId, limit]
    ).catch(() => [[]]);
    const [summaryRows] = await pool.query(
      `SELECT source, status, SUM(n) AS count FROM (
          SELECT 'job_queue' AS source, status, COUNT(*) AS n FROM job_queue WHERE tenant_id=? GROUP BY status
          UNION ALL
          SELECT 'queue_jobs' AS source, status, COUNT(*) AS n FROM queue_jobs WHERE tenant_id=? GROUP BY status
       ) x GROUP BY source, status ORDER BY source, status`
      , [req.tenantId, req.tenantId]).catch(() => [[]]);
    res.json({ summary: summaryRows, jobQueue: jobRows, queueJobs: queueRows });
  } catch (e) {
    logger.error('[queue-dashboard]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ledger reconciliation (Top20 #13): paid payments (EGP) vs cash debits posted
// to account 1100 in the journal. A non-zero diff flags payment paths that
// bypassed the ledger.
router.get('/api/admin/reconcile-ledger', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.tenantId || 'tenant-default';
    const [[pay]] = await pool.query("SELECT COUNT(*) AS n FROM payments WHERE tenant_id=? AND status='paid'", [tenantId]);
    const [[jrnl]] = await pool.query("SELECT COALESCE(SUM(jel.debit),0) AS total FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.entry_id WHERE je.tenant_id=? AND je.ref_type='payment' AND jel.account_code='1100'", [tenantId]);
    const paymentsTotal = await sumPaidPaymentsEgp('AND tenant_id=?', [tenantId]);
    const journalCashTotal = Number(jrnl.total) || 0;
    const diff = +(paymentsTotal - journalCashTotal).toFixed(2);
    res.json({
      paymentsTotalEgp: paymentsTotal,
      paymentsCount: Number(pay.n) || 0,
      journalCashDebitsEgp: journalCashTotal,
      diff,
      balanced: Math.abs(diff) < 0.01,
      note: 'Paid payments are normalised to EGP with the same FX helper used by payment journal posting. diff>0 means paid payments not yet posted to the ledger; diff<0 means over-posting or legacy journal rows needing review.',
    });
  } catch (e) {
    logger.error('[reconcile]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/financial-audit-dashboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const tenantId = req.tenantId || 'tenant-default';
    const tenantParams = [tenantId];
    const tenantWhere = 'tenant_id = ?';

    const [[payments]] = await pool.query(
      `SELECT
          COUNT(*) AS total_count,
          COALESCE(SUM(status='paid'),0) AS paid_count,
          COALESCE(SUM(status='refunded'),0) AS refunded_count,
          COALESCE(SUM(CASE WHEN status='paid' THEN amount_egp ELSE 0 END),0) AS paid_egp
       FROM payments
       WHERE ${tenantWhere}`,
      tenantParams
    ).catch(() => [[{ total_count: 0, paid_count: 0, refunded_count: 0, paid_egp: 0 }]]);

    const [[refunds]] = await pool.query(
      `SELECT
          COUNT(*) AS total_count,
          COALESCE(SUM(status='pending'),0) AS pending_count,
          COALESCE(SUM(status='approved'),0) AS approved_count,
          COALESCE(SUM(status='rejected'),0) AS rejected_count
       FROM refund_requests
       WHERE ${tenantWhere}`,
      tenantParams
    ).catch(() => [[{ total_count: 0, pending_count: 0, approved_count: 0, rejected_count: 0 }]]);

    const [recentPayments] = await pool.query(
      `SELECT id, subscriber_id, amount, currency, payment_type, payment_method, status, date, created_at
       FROM payments
       WHERE ${tenantWhere}
       ORDER BY created_at DESC
       LIMIT ?`,
      [...tenantParams, limit]
    ).catch(() => [[]]);

    const [recentRefunds] = await pool.query(
      `SELECT id, subscriber_id, payment_id, amount, status, reason, admin_note, resolved_by, created_at, resolved_at
       FROM refund_requests
       WHERE ${tenantWhere}
       ORDER BY created_at DESC
       LIMIT ?`,
      [...tenantParams, limit]
    ).catch(() => [[]]);

    const [recentJournal] = await pool.query(
      `SELECT id, ref_type, ref_id, entry_date, description, total_debit, total_credit, posted_by, created_at
       FROM journal_entries
       WHERE tenant_id=?
       ORDER BY created_at DESC
       LIMIT ?`,
      [tenantId, limit]
    ).catch(() => [[]]);

    const paymentCashTotal = await sumPaidPaymentsEgp(`AND ${tenantWhere}`, tenantParams).catch(() => 0);
    const [[journalCash]] = await pool.query(
      `SELECT COALESCE(SUM(jel.debit),0) AS total
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.entry_id
       WHERE je.tenant_id=? AND je.ref_type='payment' AND jel.account_code='1100'`,
      [tenantId]
    ).catch(() => [[{ total: 0 }]]);
    const diff = +(paymentCashTotal - (Number(journalCash.total) || 0)).toFixed(2);

    const [duplicatePaymentJournals] = await pool.query(
      `SELECT je.ref_id AS payment_id, COUNT(DISTINCT je.id) AS journal_count, COALESCE(SUM(jel.debit),0) AS cash_debit
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.entry_id = je.id AND jel.account_code='1100'
       WHERE je.tenant_id=? AND je.ref_type='payment' AND je.ref_id IS NOT NULL
       GROUP BY je.ref_id
       HAVING COUNT(DISTINCT je.id) > 1
       ORDER BY journal_count DESC, cash_debit DESC
       LIMIT 25`
    , [tenantId]).catch(() => [[]]);
    const [orphanPaymentJournals] = await pool.query(
      `SELECT je.ref_id AS payment_id, COUNT(DISTINCT je.id) AS journal_count, COALESCE(SUM(jel.debit),0) AS cash_debit
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.entry_id = je.id AND jel.account_code='1100'
       LEFT JOIN payments p ON p.id = je.ref_id AND p.tenant_id=je.tenant_id
       WHERE je.tenant_id=? AND je.ref_type='payment' AND je.ref_id IS NOT NULL AND p.id IS NULL
       GROUP BY je.ref_id
       ORDER BY cash_debit DESC
       LIMIT 25`
    , [tenantId]).catch(() => [[]]);
    const [missingPaymentJournals] = await pool.query(
      `SELECT p.id, p.subscriber_id, p.amount, p.currency, p.status, p.created_at
       FROM payments p
       LEFT JOIN journal_entries je ON je.tenant_id=p.tenant_id AND je.ref_type='payment' AND je.ref_id = p.id
       WHERE p.status='paid' AND je.id IS NULL AND ${tenantWhere}
       ORDER BY p.created_at DESC
       LIMIT 25`,
      tenantParams
    ).catch(() => [[]]);

    res.json({
      tenantId,
      summary: { payments, refunds },
      reconciliation: {
        paymentsCashEgp: paymentCashTotal,
        journalCashDebitEgp: Number(journalCash.total) || 0,
        diff,
        balanced: Math.abs(diff) < 0.01,
      },
      recent: { payments: recentPayments, refunds: recentRefunds, journalEntries: recentJournal },
      issues: {
        duplicatePaymentJournals,
        orphanPaymentJournals,
        missingPaymentJournals,
      },
      rollbackPolicy: {
        destructiveRollbackAllowed: false,
        recommendedAction: 'Create a reviewed reversal journal entry and keep the original payment/refund audit trail intact.',
      },
    });
  } catch (e) {
    logger.error('[financial-audit-dashboard]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// NOTE: GET /api/openapi.json is owned by routes/docs.js (which also mounts the
// Swagger UI at /api/docs and needs the spec public). A duplicate registration
// here shadowed it (monitoring mounts before docs in server.js), so it was removed
// to keep a single source of truth for the spec route.

module.exports = router;
