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
const { clientKinds } = require('../../lib/loginClientKind');
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
    // Who each account is in the client base, by the number in every spelling and by the email (lib/loginClientKind.js), not only by the
    // firebase_uid link a client gets the first time they open their own page.
    const kinds = await clientKinds(pool, {
      tenantId: req.tenantId,
      people: rows.map(row => ({ key: String(row.id), phone: row.phone, email: row.email, subscriberId: row.subscriber_id })),
    });
    const out = rows.map(row => {
      const c = counts.get(String(row.id)) || {};
      const kind = kinds.get(String(row.id)) || {};
      const last = lastOf.get(String(row.id)) || null;
      return {
        ...row,
        subscriber_id: row.subscriber_id || kind.subscriber_id || null,
        client_code: row.client_code || kind.client_code || null,
        name: row.name || kind.name || null,
        client_kind: kind.kind || 'none',
        branch_label: kind.branch_label || '—',
        also_lead: Boolean(kind.also_lead),
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
    // The count starts over from now, or the next sign-in finds the same devices in the log and locks the account again.
    await pool.query('UPDATE users SET sharing_locked_until=NULL, sharing_lock_reason=NULL, sharing_reset_at=NOW() WHERE id=? AND tenant_id=?', [user.id, req.tenantId]);
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
    const kinds = await clientKinds(pool, {
      tenantId: req.tenantId,
      people: rows.map(row => ({ key: String(row.id), phone: row.phone, email: row.email, subscriberId: row.subscriber_id })),
    });
    res.json(rows.map(row => {
      const kind = kinds.get(String(row.id)) || {};
      return {
        ...shapeEvent(row, rows.filter(other => other.user_id && other.user_id === row.user_id && other.id > row.id)),
        subscriber_id: row.subscriber_id || kind.subscriber_id || null,
        client_code: row.client_code || kind.client_code || null,
        name: row.name || kind.name || null,
        client_kind: kind.kind || 'none',
        branch_label: kind.branch_label || '—',
        also_lead: Boolean(kind.also_lead),
      };
    }));
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

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Expense Category Analytics ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

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
