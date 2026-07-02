'use strict';
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');

const { pool, cacheInvalidate } = require('../../lib/db');
const { mailer, sendEmail, htmlEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, validate } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, mapBundle, mapTherapist, getNextClientCode } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logPaymentAudit, logFinancialAudit, postJournalEntry, _paymentAccountCode, _expenseAccountCode, toEgp } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');
const { syncLeadDealValue } = require('../public-orders');
const { logLeadEvent } = require('../../lib/crm');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { ADMIN_EMAILS, ADMIN_UIDS, requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { paymobLimiter, whatsappSendLimiter, publicLimiter, contactLimiter } = require('../../middleware/rateLimits');
const { safeDateOnly } = require('../../lib/dates');
const { isString, validateBody } = require('../../middleware/validate');

router.post('/api/admin/backfill-payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, crm_json FROM subscribers WHERE crm_json IS NOT NULL LIMIT 5000`
    );
    let inserted = 0, skipped = 0;
    const VALID_TYPES = new Set(['COURSE','CERTIFICATE','CONSULTATION','BOOK','CARNEH','OTHER']);
    for (const row of rows) {
      const crm = tryJson(row.crm_json, {});
      const history = Array.isArray(crm.paymentHistory) ? crm.paymentHistory : [];
      for (const p of history) {
        if (!p.id || !p.amount || Number(p.amount) <= 0) { skipped++; continue; }
        const payType = (p.paymentType || 'OTHER').toUpperCase();
        const safeType = VALID_TYPES.has(payType) ? payType : 'OTHER';
        const dateVal = p.at || p.date || new Date().toISOString().slice(0, 10);
        try {
          const [result] = await pool.query(
            `INSERT IGNORE INTO payments
               (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
                payment_method, transaction_id, is_installment, date, note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              p.id, row.id,
              p.courseId || null, p.bundleId || null,
              Number(p.amount) || 0,
              p.currency || 'EGP',
              safeType,
              p.paymentMethod || null,
              p.transactionId || null,
              p.isInstallment ? 1 : 0,
              typeof dateVal === 'string' ? dateVal.slice(0,10) : new Date().toISOString().slice(0,10),
              p.note || null,
            ]
          );
          if (result.affectedRows > 0) inserted++; else skipped++;
        } catch (_) { skipped++; }
      }
    }
    logger.info(`[backfill-payments] inserted=${inserted} skipped=${skipped}`);
    res.json({ ok: true, inserted, skipped });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Shows every subscriber who has access to a course but no payment record.
// Used to audit the historical gap (735 enrollments vs ~1 payment record).
router.get('/api/admin/reconcile-payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        s.name,
        s.email,
        s.client_code,
        s.branch,
        c.title   AS course_title,
        e.enrolled_at,
        p.id      AS payment_id,
        p.amount  AS payment_amount
      FROM enrollments e
      JOIN subscribers s ON s.id = e.subscriber_id
      LEFT JOIN courses c ON c.id = e.course_id
      LEFT JOIN payments p ON p.subscriber_id = e.subscriber_id
        AND (p.course_id = e.course_id OR p.course_id IS NULL)
      WHERE p.id IS NULL
      ORDER BY e.enrolled_at DESC
      LIMIT 500
    `);
    const [[totals]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM enrollments) AS total_enrollments,
        (SELECT COUNT(*) FROM payments)    AS total_payments,
        COUNT(DISTINCT e.id)               AS unpaid_enrollments
      FROM enrollments e
      LEFT JOIN payments p ON p.subscriber_id = e.subscriber_id
        AND (p.course_id = e.course_id OR p.course_id IS NULL)
      WHERE p.id IS NULL
    `);
    res.json({ summary: totals, unpaid: rows });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Payment Audit Log ────────────────────────────────────────────────────────
// GET /api/admin/payment-audit — paginated audit trail for all payment events
router.get('/api/admin/payment-audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1'));
    const limit = Math.min(200, parseInt(req.query.limit || '50'));
    const offset = (page - 1) * limit;
    const { paymentId, action, dateFrom, dateTo } = req.query;

    let where = '1=1';
    const params = [];
    if (paymentId) { where += ' AND a.payment_id = ?'; params.push(paymentId); }
    if (action)    { where += ' AND a.action = ?';     params.push(action); }
    if (dateFrom)  { where += ' AND a.created_at >= ?'; params.push(dateFrom + ' 00:00:00'); }
    if (dateTo)    { where += ' AND a.created_at <= ?'; params.push(dateTo + ' 23:59:59'); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM payment_audit_log a WHERE ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT a.*, s.name AS subscriber_name, s.client_code
       FROM payment_audit_log a
       LEFT JOIN subscribers s ON s.id = a.subscriber_id
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ total, page, limit, rows });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Server Monitor ────────────────────────────────────────────────────────────
// GET /api/admin/ai/config — returns the Gemini key (admin only, never in client bundle).
// Prefers the key entered IN THE SYSTEM (admin AI settings → site_config.settings →
// adminAiConfig.apiKey) so no .env var is required; falls back to GEMINI_API_KEY env.
router.get('/api/admin/ai/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    let geminiKey = null;
    try {
      const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'settings' LIMIT 1");
      const settings = rows[0]?.value ? JSON.parse(rows[0].value) : {};
      const aiCfg = settings.adminAiConfig || {};
      if (aiCfg.apiKey && (aiCfg.provider === 'gemini' || !aiCfg.provider)) geminiKey = aiCfg.apiKey;
    } catch { /* fall through to env */ }
    const source = geminiKey ? 'admin' : (process.env.GEMINI_API_KEY ? 'env' : null);
    if (!geminiKey) geminiKey = process.env.GEMINI_API_KEY || null;
    res.json({ geminiKey, source });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/server-status — process info + watchdog log (nohup mode, no PM2)
router.get('/api/admin/server-status', requireAuth, requireAdmin, (req, res) => {
  const _path = require('path');
  const _fs2 = require('fs');

  // Build process info from the CURRENT running process (nohup mode)
  const mem = process.memoryUsage();
  const pm2Info = {
    status: 'online',
    uptime: Math.round(process.uptime() * 1000), // ms
    restarts: 0,
    memory: mem.rss,
    cpu: 0,
    pid: process.pid,
  };

  // Tail cron.log (last 30 lines — written by Hostinger cron watchdog.sh)
  let watchdogLog = [];
  try {
    const cronLogPath = _path.join(__dirname, 'cron.log');
    const watchdogLogPath = _path.join(__dirname, 'watchdog.log');
    const logPath = _fs2.existsSync(cronLogPath) ? cronLogPath : watchdogLogPath;
    if (_fs2.existsSync(logPath)) {
      const lines = _fs2.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
      watchdogLog = lines.slice(-30);
    }
  } catch (_) {}

  // Read crash-history.log — permanent, never trimmed
  let crashHistory = [];
  let totalCrashes = 0;
  let totalStarts = 0;
  let autoHeals = 0;
  try {
    const crashPath = _path.join(__dirname, 'crash-history.log');
    if (_fs2.existsSync(crashPath)) {
      const lines = _fs2.readFileSync(crashPath, 'utf8').split('\n').filter(Boolean);
      totalCrashes = lines.filter(l => l.includes('[CRASH]')).length;
      totalStarts  = lines.filter(l => l.includes('[START]')).length;
      autoHeals    = lines.filter(l => l.includes('[AUTO-HEAL]')).length;
      crashHistory = lines.slice(-100);
    }
  } catch (_) {}

  res.json({
    ok: true,
    time: new Date().toISOString(),
    pm2: pm2Info,
    watchdogLog,
    crashHistory,
    stats: { totalCrashes, totalStarts, autoHeals },
    memNow: mem.rss,
    dbPool: { connectionLimit: pool.pool?.config?.connectionLimit ?? null },
  });
});

// POST /api/admin/server-restart — restart via watchdog (nohup mode, no PM2)
router.post('/api/admin/server-restart', requireAuth, requireAdmin, (req, res) => {
  const { spawn } = require('child_process');
  const _path = require('path');
  const NODE2 = '/opt/alt/alt-nodejs22/root/usr/bin/node';
  const APP_DIR = __dirname;

  // Respond first so the client gets the response before we die
  res.json({ ok: true, message: 'جاري إعادة التشغيل... سيعود خلال ثوانٍ' });

  // Spawn a detached child that kills us and relaunches (watchdog also catches the gap)
  setTimeout(() => {
    const child = spawn('/bin/bash', ['-c',
      `sleep 2 && for pid in $(ps aux | grep nodejs22 | grep -v grep | awk '{print $2}'); do kill -9 $pid 2>/dev/null; done; rm -f /tmp/mahad_supervisor.pid; sleep 2 && cd '${APP_DIR}' && nohup ${NODE2} supervisor.js >> '${APP_DIR}/server.log' 2>&1 &`
    ], { detached: true, stdio: 'ignore' });
    child.unref();
  }, 500);
});


// ── Expenses CRUD ─────────────────────────────────────────────────────────────
// Posts the double-entry journal for an expense (debit 5xxx, credit 1100), normalised to EGP.
// sign=+1 records the expense, sign=-1 posts a reversal (on update/delete).
module.exports = router;
