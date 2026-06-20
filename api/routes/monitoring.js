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

async function safeCount(sql, params = []) {
  try { const [[r]] = await pool.query(sql, params); return Number(r.n); }
  catch { return null; }
}

router.get('/api/admin/monitoring', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const mem = process.memoryUsage();
    let dbOk = true;
    const t0 = Date.now();
    try { await pool.query('SELECT 1'); } catch { dbOk = false; }
    const dbLatencyMs = Date.now() - t0;

    const [outboxPending, outboxFailed, outboxDead, jobsPending, jobsFailed, jobsDead, auditToday] = await Promise.all([
      safeCount("SELECT COUNT(*) n FROM message_outbox WHERE status='pending'"),
      safeCount("SELECT COUNT(*) n FROM message_outbox WHERE status='failed'"),
      safeCount("SELECT COUNT(*) n FROM message_outbox WHERE status='dead'"),
      safeCount("SELECT COUNT(*) n FROM job_queue WHERE status='pending'"),
      safeCount("SELECT COUNT(*) n FROM job_queue WHERE status='failed'"),
      safeCount("SELECT COUNT(*) n FROM job_queue WHERE status='dead'"),
      safeCount('SELECT COUNT(*) n FROM financial_audit_log WHERE created_at >= CURDATE()'),
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
      audit: { financialEventsToday: auditToday },
    });
  } catch (e) {
    logger.error('[monitoring]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ledger reconciliation (Top20 #13): paid payments (EGP) vs cash debits posted
// to account 1100 in the journal. A non-zero diff flags payment paths that
// bypassed the ledger.
router.get('/api/admin/reconcile-ledger', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [[pay]] = await pool.query("SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM payments WHERE status='paid' AND (currency IS NULL OR currency='EGP')");
    const [[jrnl]] = await pool.query("SELECT COALESCE(SUM(jel.debit),0) AS total FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.entry_id WHERE je.ref_type='payment' AND jel.account_code='1100'");
    const paymentsTotal = Number(pay.total) || 0;
    const journalCashTotal = Number(jrnl.total) || 0;
    const diff = +(paymentsTotal - journalCashTotal).toFixed(2);
    res.json({
      paymentsTotalEgp: paymentsTotal,
      paymentsCount: Number(pay.n) || 0,
      journalCashDebitsEgp: journalCashTotal,
      diff,
      balanced: Math.abs(diff) < 0.01,
      note: 'diff>0 means paid payments not yet posted to the ledger (run a backfill); diff<0 means over-posting.',
    });
  } catch (e) {
    logger.error('[reconcile]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve the generated OpenAPI spec (Top20 #17).
router.get('/api/openapi.json', requireAuth, requireAdmin, (_req, res) => {
  try {
    res.json(require('../docs/openapi.json'));
  } catch {
    res.status(404).json({ error: 'spec not generated — run tools/gen-openapi.mjs' });
  }
});

module.exports = router;
