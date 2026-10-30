'use strict';
const logger = require('../../lib/logger');
const { uuidv4 } = require('../../lib/id');
const { pool } = require('../../lib/db');
const { mailer, sendEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff, invalidateIdentity , requirePermission } = require('../../middleware/auth');
const express = require('express');
const router = express.Router();
const ROUTE_LOCAL_CRONS_ENABLED = false;
const { sendDailyReport, scheduleDailyReport, runFollowUpReminders, scheduleFollowUpReminders, runPaymentDueReminders, schedulePaymentReminders, getSysConfig, setSysConfig, SYS_DEFAULTS, KV_ALLOWED_KEYS } = require('./_shared');
const { createNotification } = require('../../lib/notification');
const { cairoToday, cairoDayBoundsUtc, cairoDayStartUtc, cairoMonthStart, sqlCairoWall } = require('../../lib/dates');

router.get('/api/admin/analytics/conversion-funnel', requireAuth, requireAdminOrStaff, requirePermission('view_reports'), async (req, res) => {
  try {
    const from = req.query.from || cairoMonthStart(2);
    const to   = req.query.to   || cairoToday();
    // from/to are Cairo days; the columns below are UTC instants.
    const [fromUtc, toUtc] = cairoDayBoundsUtc(from, to);

    const [byStatus] = await pool.query(`
      SELECT status, COUNT(*) AS cnt FROM leads
      WHERE tenant_id=? AND created_at >= ? AND created_at < ?
      GROUP BY status`, [req.tenantId, fromUtc, toUtc]);

    const statusMap = Object.fromEntries(byStatus.map(r => [r.status, parseInt(r.cnt)]));

    const total = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const converted = statusMap['converted'] || 0;
    const interested = statusMap['interested'] || 0;
    const follow_up = statusMap['follow_up'] || 0;
    const lost = statusMap['lost'] || 0;

    // Source breakdown
    const [bySource] = await pool.query(`
      SELECT source, COUNT(*) AS cnt,
             SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END) AS conversions
      FROM leads WHERE tenant_id=? AND created_at >= ? AND created_at < ?
      GROUP BY source ORDER BY cnt DESC`, [req.tenantId, fromUtc, toUtc]);

    // Staff performance
    const [byStaff] = await pool.query(`
      SELECT st.name AS staff_name,
             COUNT(l.id) AS total_leads,
             SUM(CASE WHEN l.status='converted' THEN 1 ELSE 0 END) AS conversions,
             ROUND(SUM(CASE WHEN l.status='converted' THEN 1 ELSE 0 END) / COUNT(l.id) * 100, 1) AS conv_rate
      FROM leads l
      JOIN staff st ON st.id = l.assigned_sales_id AND st.tenant_id=l.tenant_id
      WHERE l.tenant_id=? AND l.created_at >= ? AND l.created_at < ?
      GROUP BY l.assigned_sales_id ORDER BY conversions DESC`, [req.tenantId, fromUtc, toUtc]);

    res.json({
      period: { from, to },
      funnel: {
        total,
        interested,
        follow_up,
        converted,
        lost,
        conversionRate: total > 0 ? Math.round(converted / total * 100 * 10) / 10 : 0,
      },
      bySource: bySource.map(r => ({
        source: r.source,
        total: parseInt(r.cnt),
        conversions: parseInt(r.conversions),
        convRate: r.cnt > 0 ? Math.round(r.conversions / r.cnt * 100 * 10) / 10 : 0,
      })),
      byStaff,
    });
  } catch (e) { logger.error(e); res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' }); }
});

// GET /api/admin/analytics/revenue-forecast?months=3
router.get('/api/admin/analytics/revenue-forecast', requireAuth, requireAdminOrStaff, requirePermission('view_reports'), async (req, res) => {
  try {
    const months = Math.min(parseInt(req.query.months || 3), 12);

    // Get last 6 months of revenue for trend
    const [history] = await pool.query(`
      SELECT DATE_FORMAT(${sqlCairoWall('created_at')}, '%Y-%m') AS month, SUM(amount_egp) AS revenue
      FROM payments WHERE tenant_id=? AND status='paid' AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH) AND deleted_at IS NULL
      GROUP BY month ORDER BY month`, [req.tenantId]);

    if (history.length < 2) return res.json({ forecast: [], message: 'Insufficient data' });

    const values = history.map(r => parseFloat(r.revenue));
    // Simple linear regression
    const n = values.length;
    const sumX = n * (n - 1) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((s, v, i) => s + i * v, 0);
    const sumX2 = values.reduce((s, _, i) => s + i * i, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const forecast = [];
    const lastMonth = new Date(history[history.length - 1].month + '-01');
    for (let i = 1; i <= months; i++) {
      const d = new Date(lastMonth);
      d.setMonth(d.getMonth() + i);
      const predicted = Math.max(0, intercept + slope * (n - 1 + i));
      forecast.push({
        month: d.toISOString().slice(0, 7),
        predicted: Math.round(predicted),
        low: Math.round(predicted * 0.85),
        high: Math.round(predicted * 1.15),
      });
    }

    res.json({ history, forecast, trend: slope > 0 ? 'up' : 'down', slope: Math.round(slope) });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Login History & Security Audit ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


// Helper to log login events — called from login endpoints

// ── One page for the sign-in accounts and their log ───────────────────────────
//
// «حسابات الدخول» and «سجل تسجيلات الدخول» were two pages over the same people: the accounts said who
// can get in, the log said who tried. They are one list now — an account per row with its name and
// number, how many times it signed in, and the last attempt's address, device, status and reason —
// with the whole history of one account a click away, and the stream of every attempt (including the
// ones nobody's account matches) beside it.

const { reasonLabel } = require('../../lib/loginReasons');
const SIGN_IN_OK = ['success', '2fa_success'];
// A password step that asked for a code and was followed by the code within ten minutes finished.
const TWO_FA_WINDOW_MS = 10 * 60 * 1000;

/**
 * How an attempt ended, in one word: ok | failed | pending (asked for the 2FA code and nothing came
 * after it) | done (a pending row the code completed — it is not a second sign-in). The stored status
 * alone mislabels both of the last two: «بانتظار التحقق» stayed on every row whose code was entered.
 */
function attemptState(row, newerSameUser = []) {
  if (row.status === 'failed') return 'failed';
  if (row.status === '2fa_pending') {
    const at = new Date(row.created_at).getTime();
    const done = newerSameUser.some(other => other.status === '2fa_success'
      && new Date(other.created_at).getTime() >= at && new Date(other.created_at).getTime() - at <= TWO_FA_WINDOW_MS);
    return done ? 'done' : 'pending';
  }
  return 'ok';
}

const shapeEvent = (row, siblings) => ({
  ...row,
  state: attemptState(row, siblings),
  reason_label: reasonLabel(row.failure_reason),
});

// GET /api/admin/security/accounts?q=&filter=&limit= — the accounts, with how they have been signing in.
router.get('/api/admin/security/accounts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '200', 10) || 200, 1), 500);
    const q = String(req.query.q || '').trim();
    const filter = String(req.query.filter || '').trim();

    let where = 'u.tenant_id = ?';
    const params = [req.tenantId];
    if (filter === 'no_phone') where += ' AND (u.phone IS NULL OR u.phone = \'\')';
    else if (filter === 'unverified') where += ' AND u.phone IS NOT NULL AND u.phone_verified_at IS NULL';
    else if (filter === 'locked') where += ' AND u.sharing_locked_until IS NOT NULL AND u.sharing_locked_until > NOW()';
    else if (filter === 'inactive') where += ' AND u.is_active = 0';
    else if (filter === 'never') where += ' AND u.last_login IS NULL AND COALESCE(u.login_count, 0) = 0';
    if (q) {
      // A complete email is an identifier — match it exactly so the index serves
      // it; anything else stays a contains-search over name/phone/code.
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q)) { where += ' AND u.email = ?'; params.push(q); }
      else {
        const like = `%${q}%`;
        where += ' AND (u.name LIKE ? OR s.name LIKE ? OR u.phone LIKE ? OR u.email LIKE ? OR s.client_code LIKE ?)';
        params.push(like, like, like, like, like);
      }
    }

    const [rows] = await pool.query(
      `SELECT u.id, COALESCE(NULLIF(s.name, ''), u.name) AS name, u.email, u.phone, u.phone_verified_at, u.role, u.is_active,
              (u.password_hash IS NOT NULL AND u.password_hash <> '') AS has_password,
              u.last_login, u.login_count, u.sharing_locked_until, u.sharing_lock_reason,
              u.active_session_id IS NOT NULL AS has_active_session,
              u.active_session_last_seen_at,
              s.id AS subscriber_id, s.client_code
         FROM users u
         LEFT JOIN subscribers s ON s.tenant_id = u.tenant_id AND s.firebase_uid = u.id
        WHERE ${where}
        ORDER BY u.last_login IS NULL, u.last_login DESC
        LIMIT ?`,
      [...params, limit]
    );

    // What the log says about exactly these accounts: how many times each got in (the users column is
    // only bumped by the two sign-in routes and misses everything older than it), failures this week,
    // and the last attempt — its address, device, outcome and reason.
    const ids = rows.map(row => row.id);
    const counts = new Map();
    const lastOf = new Map();
    if (ids.length) {
      const [sums] = await pool.query(
        `SELECT user_id,
                SUM(status IN ('success','2fa_success')) AS ok,
                SUM(status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS failed_7d,
                COUNT(DISTINCT CASE WHEN status IN ('success','2fa_success') AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN ip END) AS ips_7d
           FROM login_history WHERE tenant_id = ? AND user_id IN (?) GROUP BY user_id`,
        [req.tenantId, ids]);
      for (const row of sums) counts.set(String(row.user_id), row);
      const [lasts] = await pool.query(
        `SELECT h.user_id, h.ip, h.user_agent, h.status, h.failure_reason, h.created_at
           FROM login_history h
          WHERE h.id IN (SELECT MAX(id) FROM login_history WHERE tenant_id = ? AND user_id IN (?) GROUP BY user_id)`,
        [req.tenantId, ids]);
      for (const row of lasts) lastOf.set(String(row.user_id), row);
    }
    const out = rows.map(row => {
      const c = counts.get(String(row.id)) || {};
      const last = lastOf.get(String(row.id)) || null;
      return {
        ...row,
        login_count: Math.max(Number(row.login_count) || 0, Number(c.ok) || 0),
        failed_7d: Number(c.failed_7d) || 0,
        ips_7d: Number(c.ips_7d) || 0,
        last_ip: last?.ip || null,
        last_user_agent: last?.user_agent || null,
        // The last attempt has nothing after it, so a pending code is a code never entered.
        last_status: last ? attemptState(last, []) : null,
        last_reason: last ? reasonLabel(last.failure_reason) : null,
        last_attempt_at: last?.created_at || null,
      };
    });

    const [[stats]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN phone IS NULL OR phone = '' THEN 1 ELSE 0 END) AS without_phone,
              SUM(CASE WHEN phone IS NOT NULL AND phone_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified,
              SUM(CASE WHEN sharing_locked_until IS NOT NULL AND sharing_locked_until > NOW() THEN 1 ELSE 0 END) AS locked,
              SUM(CASE WHEN last_login IS NULL AND COALESCE(login_count, 0) = 0 THEN 1 ELSE 0 END) AS never
         FROM users WHERE tenant_id = ?`,
      [req.tenantId]
    );
    res.json({ rows: out, stats });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/security/accounts/:id/logins — one account's own history, newest first.
router.get('/api/admin/security/accounts/:id/logins', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);
    const [[user]] = await pool.query('SELECT id, email, phone FROM users WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!user) return res.status(404).json({ error: 'الحساب غير موجود' });
    const [rows] = await pool.query(
      `SELECT id, user_id, email, phone, ip, user_agent, status, failure_reason, created_at
         FROM login_history WHERE tenant_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?`,
      [req.tenantId, user.id, limit]);
    res.json(rows.map(row => shapeEvent(row, rows.filter(other => other.id > row.id))));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/security/accounts/:id/toggle-active — the write half of the
// listing above. Until now the admin UI reached for GET /api/admin/users and
// DELETE /api/admin/users/:id, neither of which has ever existed, so "تعطيل
// حساب العميل" on a lead could only ever fail. Deactivating also bumps
// session_version so an already signed-in customer is dropped on their next
// request rather than staying in until their token expires.
router.post('/api/admin/security/accounts/:id/toggle-active', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT id, email, name, is_active FROM users WHERE id=? AND tenant_id=? LIMIT 1',
      [req.params.id, req.tenantId]
    );
    if (!user) return res.status(404).json({ error: 'الحساب غير موجود' });

    // An explicit `active` wins so a caller that knows the state it wants is
    // not at the mercy of a stale row; otherwise flip what is there.
    const next = typeof req.body?.active === 'boolean' ? (req.body.active ? 1 : 0) : (user.is_active ? 0 : 1);
    await pool.query(
      'UPDATE users SET is_active=?, session_version=session_version+1 WHERE id=? AND tenant_id=?',
      [next, user.id, req.tenantId]
    );
    invalidateIdentity(req.tenantId, user.id, user.email);
    logger.info(`[security] account ${user.id} set is_active=${next} by ${req.user?.id || 'unknown'}`);
    res.json({
      ok: true,
      is_active: !!next,
      message: next ? `تم تفعيل حساب ${user.name || user.email}` : `تم تعطيل حساب ${user.name || user.email} — لن يتمكن من الدخول`,
    });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/security/accounts/:id/unlock — lift a sharing lock now instead of waiting it out.
router.post('/api/admin/security/accounts/:id/unlock', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT id, email, name, sharing_locked_until FROM users WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!user) return res.status(404).json({ error: 'الحساب غير موجود' });
    await pool.query('UPDATE users SET sharing_locked_until=NULL, sharing_lock_reason=NULL WHERE id=? AND tenant_id=?', [user.id, req.tenantId]);
    invalidateIdentity(req.tenantId, user.id, user.email);
    logger.info(`[security] account ${user.id} sharing lock lifted by ${req.user?.id || 'unknown'}`);
    res.json({ ok: true, message: `اتفك إيقاف حساب ${user.name || user.email || ''}` });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/security/login-history?limit=&email=&status=&q=&user_id= — every attempt, whoever it was
// for: the account's name and number when it matched one, the number or e-mail that was tried when not.
router.get('/api/admin/security/login-history', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 500);
    const { email, status, q, user_id: userId } = req.query;
    let where = 'h.tenant_id=?';
    const params = [req.tenantId];
    if (email)  { where += ' AND h.email = ?';  params.push(email);  }
    if (status) { where += ' AND h.status = ?'; params.push(status); }
    if (userId) { where += ' AND h.user_id = ?'; params.push(userId); }
    if (q && String(q).trim()) {
      const like = `%${String(q).trim()}%`;
      where += ' AND (h.email LIKE ? OR h.phone LIKE ? OR h.ip LIKE ? OR u.name LIKE ? OR u.phone LIKE ? OR s.client_code LIKE ?)';
      params.push(like, like, like, like, like, like);
    }
    const [rows] = await pool.query(
      `SELECT h.id, h.user_id, h.email, COALESCE(NULLIF(h.phone, ''), u.phone) AS phone, h.ip, h.user_agent, h.status,
              h.failure_reason, h.created_at,
              COALESCE(NULLIF(s.name, ''), u.name) AS name, s.client_code, s.id AS subscriber_id
         FROM login_history h
         LEFT JOIN users u ON u.id = h.user_id AND u.tenant_id = h.tenant_id
         LEFT JOIN subscribers s ON s.tenant_id = u.tenant_id AND s.firebase_uid = u.id
        WHERE ${where}
        ORDER BY h.id DESC LIMIT ?`,
      [...params, limit]);
    res.json(rows.map(row => shapeEvent(row, rows.filter(other => other.user_id && other.user_id === row.user_id && other.id > row.id))));
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/security/stats — summary of login activity
router.get('/api/admin/security/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM login_history WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)', [req.tenantId]);
    const [[{ failed }]] = await pool.query("SELECT COUNT(*) AS failed FROM login_history WHERE tenant_id=? AND status='failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)", [req.tenantId]);
    const [[{ unique_ips }]] = await pool.query("SELECT COUNT(DISTINCT ip) AS unique_ips FROM login_history WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)", [req.tenantId]);
    const [suspicious] = await pool.query(`
      SELECT ip, COUNT(*) AS attempts, MAX(created_at) AS last_attempt
      FROM login_history WHERE tenant_id=? AND status='failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY ip HAVING attempts >= 5 ORDER BY attempts DESC LIMIT 20`, [req.tenantId]);
    const [recentLogins] = await pool.query(`
      SELECT email, ip, status, created_at FROM login_history WHERE tenant_id=?
      ORDER BY created_at DESC LIMIT 20`, [req.tenantId]);
    const [dailyActivity] = await pool.query(`
      SELECT DATE(${sqlCairoWall('created_at')}) AS day,
             SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes,
             SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failures
      FROM login_history WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY day ORDER BY day`, [req.tenantId]);
    res.json({ total: parseInt(total), failed: parseInt(failed), unique_ips: parseInt(unique_ips), suspicious, recentLogins, dailyActivity });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Scheduled Daily Email Report ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


router.get('/api/admin/reports/daily-preview', requireAuth, requireAdminOrStaff, requirePermission('view_reports'), async (req, res) => {
  try {
    const today = req.query.date || cairoToday();
    // today is a Cairo day; the columns below are UTC instants.
    const [dayStart, dayEnd] = cairoDayBoundsUtc(today);
    const monthStart = cairoDayStartUtc(`${String(today).slice(0, 7)}-01`);
    const [[{ revenue }]] = await pool.query(`SELECT COALESCE(SUM(amount_egp),0) AS revenue FROM payments WHERE tenant_id=? AND status='paid' AND created_at >= ? AND created_at < ? AND deleted_at IS NULL`, [req.tenantId, dayStart, dayEnd]);
    const [[{ new_leads }]] = await pool.query(`SELECT COUNT(*) AS new_leads FROM leads WHERE tenant_id=? AND created_at >= ? AND created_at < ?`, [req.tenantId, dayStart, dayEnd]);
    const [[{ new_clients }]] = await pool.query(`SELECT COUNT(*) AS new_clients FROM subscribers WHERE tenant_id=? AND created_at >= ? AND created_at < ?`, [req.tenantId, dayStart, dayEnd]);
    const [[{ pending_payments }]] = await pool.query(`SELECT COUNT(*) AS pending_payments FROM payments WHERE tenant_id=? AND status='pending' AND deleted_at IS NULL`, [req.tenantId]);
    const [[{ failed_logins }]] = await pool.query(`SELECT COUNT(*) AS failed_logins FROM login_history WHERE tenant_id=? AND status='failed' AND created_at >= ? AND created_at < ?`, [req.tenantId, dayStart, dayEnd]).catch(() => [[{ failed_logins: 0 }]]);
    const [[{ month_revenue }]] = await pool.query(`SELECT COALESCE(SUM(amount_egp),0) AS month_revenue FROM payments WHERE tenant_id=? AND status='paid' AND created_at >= ? AND created_at < ? AND deleted_at IS NULL`, [req.tenantId, monthStart, dayEnd]);
    res.json({ date: today, revenue: parseFloat(revenue), new_leads: parseInt(new_leads), new_clients: parseInt(new_clients), pending_payments: parseInt(pending_payments), failed_logins: parseInt(failed_logins), month_revenue: parseFloat(month_revenue) });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' }); }
});

// POST /api/admin/reports/send-now — manually trigger the daily report
router.post('/api/admin/reports/send-now', requireAuth, requireAdminOrStaff, requirePermission('manage_notifications'), async (req, res) => {
  try {
    await sendDailyReport(req.tenantId);
    res.json({ ok: true, message: 'تم إرسال التقرير' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Client Retention & Churn Risk ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/analytics/retention?months=3
// Returns clients who have NOT made a payment in the last N months
router.get('/api/admin/analytics/retention', requireAuth, requireAdminOrStaff, requirePermission('view_reports'), async (req, res) => {
  try {
    const months = parseInt(req.query.months || '3');
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Active clients with at least 1 payment, but none recently
    const [inactive] = await pool.query(`
      -- status, total_paid and remaining_amount are not columns on subscribers:
      -- is_active carries the state and the money is summed from payments. The
      -- churn-risk report answered 500 on every open because of it. NULLS LAST
      -- is Postgres syntax and is not valid in MySQL either — a NULL max date
      -- sorts last here by putting the IS NULL test first. That test has to
      -- name MAX() itself: MariaDB refuses an expression built on an aggregate
      -- alias ("Reference not supported"), so the previous fix still answered 500.
      SELECT s.id, s.client_code, s.name, s.phone, s.email, s.branch, s.is_active,
             COALESCE(pay.total_paid, 0) AS total_paid,
             pay.last_payment_date,
             DATEDIFF(NOW(), pay.last_payment_date) AS days_since_payment
      FROM subscribers s
      -- Each client's payments are summed once, then joined: joining the payments to every active client and grouping by
      -- client took 1.4 s for 30,000 clients and 40,000 payments on the lab, this 0.5 s, same rows.
      LEFT JOIN (SELECT subscriber_id, SUM(amount) AS total_paid, MAX(created_at) AS last_payment_date
                   FROM payments WHERE tenant_id=? AND status = 'paid' AND deleted_at IS NULL
                  GROUP BY subscriber_id) pay ON pay.subscriber_id = s.id
      WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL
        AND (pay.last_payment_date IS NULL OR pay.last_payment_date < ?)
      ORDER BY pay.last_payment_date IS NULL, days_since_payment DESC
      LIMIT 500`, [req.tenantId, req.tenantId, cutoffStr]);

    // Retention rate: active clients with recent payment / all active
    const [[{ total_active }]] = await pool.query(`SELECT COUNT(*) AS total_active FROM subscribers WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL`, [req.tenantId]);
    const atRisk = inactive.length;
    const retentionRate = total_active > 0 ? Math.round((1 - atRisk / parseInt(total_active)) * 100) : 100;

    // Monthly cohort retention (new clients per month who are still active)
    const [cohorts] = await pool.query(`
      SELECT DATE_FORMAT(${sqlCairoWall('created_at')}, '%Y-%m') AS cohort,
             COUNT(*) AS total,
             SUM(CASE WHEN is_active=1 AND deleted_at IS NULL THEN 1 ELSE 0 END) AS still_active
      FROM subscribers
      WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY cohort ORDER BY cohort`, [req.tenantId]);

    res.json({
      months,
      cutoff: cutoffStr,
      retentionRate,
      atRisk: atRisk,
      totalActive: parseInt(total_active),
      inactiveClients: inactive,
      cohorts: cohorts.map(c => ({ ...c, retentionRate: c.total > 0 ? Math.round(c.still_active / c.total * 100) : 0 })),
    });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/analytics/churn-risk — clients most likely to churn
router.get('/api/admin/analytics/churn-risk', requireAuth, requireAdminOrStaff, requirePermission('view_reports'), async (req, res) => {
  try {
    const [clients] = await pool.query(`
      -- total_paid and remaining_amount are not columns on subscribers; the
      -- money is summed from payments. This 500'd the churn-risk report.
      -- The three figures are read from each client's payments once, in one pass, and joined: three subqueries per active client
      -- took 2.0 s for 30,000 clients on the lab, this 0.5 s, the same 27,040 qualifying clients with the same figures.
      -- (last_payment keeps counting a deleted paid row, as it always did; total_paid and pending_count do not.)
      SELECT s.id, s.client_code, s.name, s.phone, s.email, s.branch, s.created_at,
             COALESCE(pay.total_paid, 0) AS total_paid,
             DATEDIFF(NOW(), s.created_at) AS days_old,
             pay.last_payment,
             COALESCE(pay.pending_count, 0) AS pending_count
      FROM subscribers s
      LEFT JOIN (SELECT subscriber_id,
                        SUM(CASE WHEN status='paid' AND deleted_at IS NULL THEN amount ELSE 0 END) AS total_paid,
                        MAX(CASE WHEN status='paid' THEN created_at END) AS last_payment,
                        SUM(status='pending' AND deleted_at IS NULL) AS pending_count
                   FROM payments WHERE tenant_id=? GROUP BY subscriber_id) pay ON pay.subscriber_id = s.id
      WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL
        AND ((pay.last_payment IS NULL OR DATEDIFF(NOW(), pay.last_payment) > 45) OR COALESCE(pay.pending_count, 0) > 0)
      ORDER BY pending_count DESC, pay.last_payment ASC
      LIMIT 200`, [req.tenantId, req.tenantId]);

    // Score churn risk (0-100, higher = more at risk)
    const scored = clients.map(c => {
      let risk = 0;
      const daysSince = c.last_payment ? Math.floor((Date.now() - new Date(c.last_payment).getTime()) / 86400000) : 999;
      if (daysSince > 90) risk += 40;
      else if (daysSince > 60) risk += 25;
      else if (daysSince > 45) risk += 15;
      if (c.pending_count > 0) risk += Math.min(c.pending_count * 10, 30);
      if (c.remaining_amount > 0) risk += 15;
      return {
        ...c,
        days_since_payment: daysSince === 999 ? null : daysSince,
        churn_risk_score: Math.min(100, risk),
        churn_risk_label: risk >= 70 ? 'عالي' : risk >= 40 ? 'متوسط' : 'منخفض',
      };
    });

    scored.sort((a, b) => b.churn_risk_score - a.churn_risk_score);
    res.json(scored);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Staff Performance Rankings ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/analytics/staff-performance?from=&to=
router.get('/api/admin/analytics/staff-performance', requireAuth, requireAdminOrStaff, requirePermission('view_reports'), async (req, res) => {
  try {
    const from = req.query.from || cairoMonthStart(0);
    const to   = req.query.to   || cairoToday();
    // from/to are Cairo days; the columns below are UTC instants.
    const [fromUtc, toUtc] = cairoDayBoundsUtc(from, to);

    // Each figure is counted by itself, per staff member, and the four are joined to the staff list. The query this replaces
    // joined the staff to their leads, clients and tasks side by side, so every lead was repeated once for each client-and-
    // task pair of the same person: it took 26 s for a year on the lab (150,000 leads) and `leads_converted` counted those
    // repeats — 175,448 «converted» for a rep with 1,687 — so the conversion rate and the score built on it were wrong.
    const [staff] = await pool.query(`
      SELECT st.id, st.name, st.email, st.role,
        COALESCE(ls.total_leads, 0) AS total_leads, COALESCE(ls.leads_converted, 0) AS leads_converted,
        COALESCE(ss.subscribers_managed, 0) AS subscribers_managed,
        COALESCE(rv.revenue_generated, 0) AS revenue_generated,
        COALESCE(ts.tasks_done, 0) AS tasks_done, COALESCE(ts.tasks_total, 0) AS tasks_total
      FROM staff st
      LEFT JOIN (SELECT assigned_sales_id AS sid, COUNT(*) AS total_leads, SUM(status='converted') AS leads_converted
                   FROM leads WHERE tenant_id=? AND created_at >= ? AND created_at < ? AND assigned_sales_id IS NOT NULL
                  GROUP BY assigned_sales_id) ls ON ls.sid = st.id
      LEFT JOIN (SELECT assigned_sales_id AS sid, COUNT(*) AS subscribers_managed
                   FROM subscribers WHERE tenant_id=? AND created_at >= ? AND created_at < ? AND assigned_sales_id IS NOT NULL
                  GROUP BY assigned_sales_id) ss ON ss.sid = st.id
      -- Revenue generated: the payments on their clients
      LEFT JOIN (SELECT sub.assigned_sales_id AS sid, SUM(p.amount_egp) AS revenue_generated
                   FROM payments p JOIN subscribers sub ON sub.id = p.subscriber_id AND sub.tenant_id = p.tenant_id
                  WHERE p.tenant_id=? AND p.status='paid' AND p.created_at >= ? AND p.created_at < ? AND p.deleted_at IS NULL
                    AND sub.assigned_sales_id IS NOT NULL
                  GROUP BY sub.assigned_sales_id) rv ON rv.sid = st.id
      LEFT JOIN (SELECT assigned_to AS sid, COUNT(*) AS tasks_total, SUM(status='done') AS tasks_done
                   FROM tasks WHERE tenant_id=? AND created_at >= ? AND created_at < ? AND assigned_to IS NOT NULL
                  GROUP BY assigned_to) ts ON ts.sid = st.id
      WHERE st.tenant_id=? AND st.is_active = 1
      ORDER BY revenue_generated DESC`,
      [req.tenantId, fromUtc, toUtc, req.tenantId, fromUtc, toUtc, req.tenantId, fromUtc, toUtc, req.tenantId, fromUtc, toUtc, req.tenantId]
    );

    const result = staff.map(row => {
      const s = { ...row, leads_converted: Number(row.leads_converted), tasks_done: Number(row.tasks_done) };
      return {
        ...s,
        conversion_rate: s.total_leads > 0 ? Math.round(s.leads_converted / s.total_leads * 100 * 10) / 10 : 0,
        task_completion_rate: s.tasks_total > 0 ? Math.round(s.tasks_done / s.tasks_total * 100) : 0,
        revenue_generated: parseFloat(s.revenue_generated),
        // Overall performance score (weighted)
        performance_score: Math.round(
          (s.total_leads > 0 ? (s.leads_converted / s.total_leads) * 35 : 0) +
          (s.tasks_total > 0 ? (s.tasks_done / s.tasks_total) * 25 : 0) +
          Math.min(parseFloat(s.revenue_generated) / 10000, 1) * 40
        ),
      };
    });

    result.sort((a, b) => b.performance_score - a.performance_score);

    // Add rank
    result.forEach((s, i) => { s.rank = i + 1; });

    res.json({ period: { from, to }, staff: result });
  } catch (e) { logger.error(e); res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Expense Category Analytics ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/analytics/expenses?from=&to=
router.get('/api/admin/analytics/expenses', requireAuth, requireAdminOrStaff, requirePermission('view_reports'), async (req, res) => {
  try {
    const from = req.query.from || `${cairoToday().slice(0, 4)}-01-01`;
    const to   = req.query.to   || cairoToday();

    const [byCategory] = await pool.query(`
      SELECT category, COUNT(*) AS count, SUM(amount_egp) AS total
      FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND date BETWEEN ? AND ?
      GROUP BY category ORDER BY total DESC`, [req.tenantId, from, to]);

    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(date,'%Y-%m') AS month, category, SUM(amount_egp) AS total
      FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND date BETWEEN ? AND ?
      GROUP BY month, category ORDER BY month, total DESC`, [req.tenantId, from, to]);

    const [[{ grand_total }]] = await pool.query(`SELECT COALESCE(SUM(amount_egp),0) AS grand_total FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND date BETWEEN ? AND ?`, [req.tenantId, from, to]);

    res.json({
      period: { from, to },
      grandTotal: parseFloat(grand_total),
      byCategory: byCategory.map(r => ({ ...r, total: parseFloat(r.total), pct: grand_total > 0 ? Math.round(r.total / grand_total * 100) : 0 })),
      monthly,
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// The "Notification Center" that used to live here (GET .../inbox, PUT
// .../read-all, DELETE .../:id) read/wrote a second, parallel notifications
// table that no frontend caller ever queried — confirmed via grep across
// admin/ (NOT-01). The real notification center — the one the
// header bell polls and NotifInboxMgmtTab.tsx is now wired to — is
// routes/notifications.js, backed by the `notifications` table
// createNotification() writes.

// Auto-trigger notifications on important events via cron (daily check)
if (ROUTE_LOCAL_CRONS_ENABLED) setInterval(async () => {
  try {
    const [tenants] = await pool.query("SELECT id FROM tenants WHERE status='active'").catch(() => [[{ id: 'tenant-default' }]]);
    for (const { id: tenantId } of tenants) {
      const [[{ old_pending }]] = await pool.query(
        `SELECT COUNT(*) AS old_pending FROM payments WHERE tenant_id=? AND status='pending' AND created_at < DATE_SUB(NOW(), INTERVAL 3 DAY) AND deleted_at IS NULL`,
        [tenantId]
      );
      if (parseInt(old_pending) > 0) {
        await createNotification('warning', 'مدفوعات معلقة', `يوجد ${old_pending} مدفوعة معلقة منذ أكثر من 3 أيام`, { link: '/dashboard?tab=orders' }, tenantId);
      }

      const [[{ at_risk }]] = await pool.query(
        `SELECT COUNT(*) AS at_risk FROM subscribers s WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.tenant_id=s.tenant_id AND p.subscriber_id=s.id AND p.status='paid' AND p.created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY) AND p.deleted_at IS NULL)`,
        [tenantId]
      );
      if (parseInt(at_risk) >= 5) {
        await createNotification('alert', 'خطر انسحاب العملاء', `${at_risk} عميل لم يدفع منذ 60 يوماً`, { link: '/dashboard?tab=retention' }, tenantId);
      }
      const [[{ fail_count }]] = await pool.query(
        `SELECT COUNT(*) AS fail_count FROM login_history
         WHERE tenant_id=? AND status='failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
        [tenantId]
      ).catch(() => [[{ fail_count: 0 }]]);
      if (parseInt(fail_count) >= 10) {
        await createNotification('alert', 'تنبيه أمني', `${fail_count} محاولة دخول فاشلة خلال آخر ساعة`, {}, tenantId);
      }
    }
  } catch (e) { /* non-critical */ }
}, 6 * 60 * 60 * 1000); // every 6 hours

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Daily Follow-up Reminders (Leads) ────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


module.exports = router;
