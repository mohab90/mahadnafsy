'use strict';
const logger = require('../../lib/logger');
const bcrypt   = require('bcryptjs');
const { uuidv4 } = require('../../lib/id');
const { pool } = require('../../lib/db');
const { mailer, sendEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff } = require('../../middleware/auth');
const express = require('express');
const router = express.Router();
const ROUTE_LOCAL_CRONS_ENABLED = false;
const { sendDailyReport, scheduleDailyReport, runFollowUpReminders, scheduleFollowUpReminders, runPaymentDueReminders, schedulePaymentReminders, getSysConfig, setSysConfig, SYS_DEFAULTS, KV_ALLOWED_KEYS } = require('./_shared');
const { createNotification } = require('../../lib/notification');

router.get('/api/admin/analytics/conversion-funnel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.from || new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
    const to   = req.query.to   || now.toISOString().slice(0, 10);

    const [byStatus] = await pool.query(`
      SELECT status, COUNT(*) AS cnt FROM leads
      WHERE tenant_id=? AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY status`, [req.tenantId, from, to]);

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
      FROM leads WHERE tenant_id=? AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY source ORDER BY cnt DESC`, [req.tenantId, from, to]);

    // Staff performance
    const [byStaff] = await pool.query(`
      SELECT st.name AS staff_name,
             COUNT(l.id) AS total_leads,
             SUM(CASE WHEN l.status='converted' THEN 1 ELSE 0 END) AS conversions,
             ROUND(SUM(CASE WHEN l.status='converted' THEN 1 ELSE 0 END) / COUNT(l.id) * 100, 1) AS conv_rate
      FROM leads l
      JOIN staff st ON st.id = l.assigned_sales_id AND st.tenant_id=l.tenant_id
      WHERE l.tenant_id=? AND DATE(l.created_at) BETWEEN ? AND ?
      GROUP BY l.assigned_sales_id ORDER BY conversions DESC`, [req.tenantId, from, to]);

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
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/analytics/revenue-forecast?months=3
router.get('/api/admin/analytics/revenue-forecast', requireAuth, requireAdmin, async (req, res) => {
  try {
    const months = Math.min(parseInt(req.query.months || 3), 12);

    // Get last 6 months of revenue for trend
    const [history] = await pool.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, SUM(amount_egp) AS revenue
      FROM payments WHERE tenant_id=? AND status='paid' AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
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

router.get('/api/admin/security/login-history', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100'), 500);
    const { email, status } = req.query;
    let sql = 'SELECT id, user_id, email, ip, user_agent, status, failure_reason, created_at FROM login_history WHERE tenant_id=?';
    const params = [req.tenantId];
    if (email)  { sql += ' AND email = ?';  params.push(email);  }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const [rows] = await pool.query(sql, params);
    res.json(rows);
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
      SELECT DATE(created_at) AS day,
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


router.get('/api/admin/reports/daily-preview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const today = req.query.date || new Date().toISOString().slice(0, 10);
    const [[{ revenue }]] = await pool.query(`SELECT COALESCE(SUM(amount_egp),0) AS revenue FROM payments WHERE tenant_id=? AND status='paid' AND DATE(created_at)=?`, [req.tenantId, today]);
    const [[{ new_leads }]] = await pool.query(`SELECT COUNT(*) AS new_leads FROM leads WHERE tenant_id=? AND DATE(created_at)=?`, [req.tenantId, today]);
    const [[{ new_clients }]] = await pool.query(`SELECT COUNT(*) AS new_clients FROM subscribers WHERE tenant_id=? AND DATE(created_at)=?`, [req.tenantId, today]);
    const [[{ pending_payments }]] = await pool.query(`SELECT COUNT(*) AS pending_payments FROM payments WHERE tenant_id=? AND status='pending'`, [req.tenantId]);
    const [[{ failed_logins }]] = await pool.query(`SELECT COUNT(*) AS failed_logins FROM login_history WHERE tenant_id=? AND status='failed' AND DATE(created_at)=?`, [req.tenantId, today]).catch(() => [[{ failed_logins: 0 }]]);
    const [[{ month_revenue }]] = await pool.query(`SELECT COALESCE(SUM(amount_egp),0) AS month_revenue FROM payments WHERE tenant_id=? AND status='paid' AND DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(NOW(),'%Y-%m')`, [req.tenantId]);
    res.json({ date: today, revenue: parseFloat(revenue), new_leads: parseInt(new_leads), new_clients: parseInt(new_clients), pending_payments: parseInt(pending_payments), failed_logins: parseInt(failed_logins), month_revenue: parseFloat(month_revenue) });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/reports/send-now — manually trigger the daily report
router.post('/api/admin/reports/send-now', requireAuth, requireAdmin, async (req, res) => {
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
router.get('/api/admin/analytics/retention', requireAuth, requireAdmin, async (req, res) => {
  try {
    const months = parseInt(req.query.months || '3');
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Active clients with at least 1 payment, but none recently
    const [inactive] = await pool.query(`
      SELECT s.id, s.client_code, s.name, s.phone, s.email, s.branch, s.status,
             s.total_paid, s.remaining_amount,
             MAX(p.created_at) AS last_payment_date,
             DATEDIFF(NOW(), MAX(p.created_at)) AS days_since_payment
      FROM subscribers s
      LEFT JOIN payments p ON p.subscriber_id = s.id AND p.tenant_id=s.tenant_id AND p.status = 'paid'
      WHERE s.tenant_id=? AND s.status NOT IN ('inactive','cancelled')
      GROUP BY s.id
      HAVING (last_payment_date IS NULL OR last_payment_date < ?)
      ORDER BY days_since_payment DESC NULLS LAST
      LIMIT 500`, [req.tenantId, cutoffStr]);

    // Retention rate: active clients with recent payment / all active
    const [[{ total_active }]] = await pool.query(`SELECT COUNT(*) AS total_active FROM subscribers WHERE tenant_id=? AND status NOT IN ('inactive','cancelled')`, [req.tenantId]);
    const atRisk = inactive.length;
    const retentionRate = total_active > 0 ? Math.round((1 - atRisk / parseInt(total_active)) * 100) : 100;

    // Monthly cohort retention (new clients per month who are still active)
    const [cohorts] = await pool.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS cohort,
             COUNT(*) AS total,
             SUM(CASE WHEN status NOT IN ('inactive','cancelled') THEN 1 ELSE 0 END) AS still_active
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
router.get('/api/admin/analytics/churn-risk', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [clients] = await pool.query(`
      SELECT s.id, s.client_code, s.name, s.phone, s.email, s.branch,
             s.total_paid, s.remaining_amount, s.created_at,
             DATEDIFF(NOW(), s.created_at) AS days_old,
             (SELECT MAX(p.created_at) FROM payments p WHERE p.tenant_id=s.tenant_id AND p.subscriber_id = s.id AND p.status='paid') AS last_payment,
             (SELECT COUNT(*) FROM payments p WHERE p.tenant_id=s.tenant_id AND p.subscriber_id = s.id AND p.status='pending') AS pending_count
      FROM subscribers s
      WHERE s.tenant_id=? AND s.status NOT IN ('inactive','cancelled')
      HAVING (last_payment IS NULL OR DATEDIFF(NOW(), last_payment) > 45) OR pending_count > 0
      ORDER BY pending_count DESC, last_payment ASC
      LIMIT 200`, [req.tenantId]);

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
router.get('/api/admin/analytics/staff-performance', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to   = req.query.to   || now.toISOString().slice(0, 10);

    const [staff] = await pool.query(`
      SELECT st.id, st.name, st.email, st.role,
        -- Leads handled
        COUNT(DISTINCT l.id) AS total_leads,
        SUM(CASE WHEN l.status='converted' THEN 1 ELSE 0 END) AS leads_converted,
        -- Subscribers managed
        COUNT(DISTINCT s.id) AS subscribers_managed,
        -- Revenue generated (payments on their clients)
        COALESCE((
          SELECT SUM(p.amount_egp) FROM payments p
          JOIN subscribers sub ON sub.id = p.subscriber_id AND sub.tenant_id=p.tenant_id
          WHERE p.tenant_id=st.tenant_id AND sub.assigned_sales_id = st.id AND p.status='paid' AND DATE(p.created_at) BETWEEN ? AND ?
        ), 0) AS revenue_generated,
        -- Tasks completed
        COUNT(DISTINCT CASE WHEN t.status='done' THEN t.id END) AS tasks_done,
        COUNT(DISTINCT t.id) AS tasks_total
      FROM staff st
      LEFT JOIN leads l ON l.tenant_id=st.tenant_id AND l.assigned_sales_id = st.id AND DATE(l.created_at) BETWEEN ? AND ?
      LEFT JOIN subscribers s ON s.tenant_id=st.tenant_id AND s.assigned_sales_id = st.id AND DATE(s.created_at) BETWEEN ? AND ?
      LEFT JOIN tasks t ON t.tenant_id=st.tenant_id AND t.assigned_to = st.id AND DATE(t.created_at) BETWEEN ? AND ?
      WHERE st.tenant_id=? AND st.is_active = 1
      GROUP BY st.id
      ORDER BY revenue_generated DESC`,
      [from, to, from, to, from, to, from, to, req.tenantId]
    );

    const result = staff.map(s => ({
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
    }));

    result.sort((a, b) => b.performance_score - a.performance_score);

    // Add rank
    result.forEach((s, i) => { s.rank = i + 1; });

    res.json({ period: { from, to }, staff: result });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Expense Category Analytics ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/analytics/expenses?from=&to=
router.get('/api/admin/analytics/expenses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.from || new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    const to   = req.query.to   || now.toISOString().slice(0, 10);

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
        `SELECT COUNT(*) AS old_pending FROM payments WHERE tenant_id=? AND status='pending' AND created_at < DATE_SUB(NOW(), INTERVAL 3 DAY)`,
        [tenantId]
      );
      if (parseInt(old_pending) > 0) {
        await createNotification('warning', 'مدفوعات معلقة', `يوجد ${old_pending} مدفوعة معلقة منذ أكثر من 3 أيام`, { link: '/dashboard?tab=orders' }, tenantId);
      }

      const [[{ at_risk }]] = await pool.query(
        `SELECT COUNT(*) AS at_risk FROM subscribers s WHERE s.tenant_id=? AND s.status NOT IN ('inactive','cancelled') AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.tenant_id=s.tenant_id AND p.subscriber_id=s.id AND p.status='paid' AND p.created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY))`,
        [tenantId]
      );
      if (parseInt(at_risk) >= 5) {
        await createNotification('alert', 'خطر انسحاب العملاء', `${at_risk} عميل لم يدفع منذ 60 يوماً`, { link: '/dashboard?tab=retention' }, tenantId);
      }
    }

    // Check for failed login spikes
    const [[{ fail_count }]] = await pool.query(
      `SELECT COUNT(*) AS fail_count FROM login_history WHERE status='failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`
    ).catch(() => [[{ fail_count: 0 }]]);
    if (parseInt(fail_count) >= 10) {
      // Deliberately not tenant-scoped: the underlying query counts failed
      // logins across ALL tenants, so there is no single tenantId to pass —
      // same reasoning as lib/reconcileJob.js's system-wide integrity alert.
      await createNotification('alert', 'تنبيه أمني', `${fail_count} محاولة دخول فاشلة خلال آخر ساعة`, {}, undefined);
    }
  } catch (e) { /* non-critical */ }
}, 6 * 60 * 60 * 1000); // every 6 hours

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Daily Follow-up Reminders (Leads) ────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


module.exports = router;
