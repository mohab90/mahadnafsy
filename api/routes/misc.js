'use strict';
const logger = require('../lib/logger');
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { mailer, sendEmail } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: SMS Integration (via WhatsApp fallback / Vonage / InfoBip) ───
// ═══════════════════════════════════════════════════════════════════════════

// Ensure sms_settings table
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS sms_settings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      provider VARCHAR(50) DEFAULT 'vonage' COMMENT 'vonage|infobip|custom',
      api_key VARCHAR(255) DEFAULT '',
      api_secret VARCHAR(255) DEFAULT '',
      sender_id VARCHAR(50) DEFAULT 'MAHAD',
      is_active TINYINT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
  } catch (e) { logger.warn('[sms_settings]', e.message); }
})();

// GET /api/admin/sms-settings
router.get('/api/admin/sms-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, provider, sender_id, is_active, updated_at FROM sms_settings LIMIT 1');
    res.json(rows[0] || { provider: 'vonage', sender_id: 'MAHAD', is_active: 0 });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/sms-settings
router.put('/api/admin/sms-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { provider, api_key, api_secret, sender_id, is_active } = req.body;
    const [exist] = await pool.query('SELECT id FROM sms_settings LIMIT 1');
    if (exist.length > 0) {
      await pool.query('UPDATE sms_settings SET provider=?, api_key=?, api_secret=?, sender_id=?, is_active=? WHERE id=?',
        [provider, api_key, api_secret, sender_id, is_active ? 1 : 0, exist[0].id]);
    } else {
      await pool.query('INSERT INTO sms_settings (provider, api_key, api_secret, sender_id, is_active) VALUES (?,?,?,?,?)',
        [provider, api_key, api_secret, sender_id, is_active ? 1 : 0]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/sms/send  — send single SMS
router.post('/api/admin/sms/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });

    const [rows] = await pool.query(
      'SELECT id, provider, api_key, api_secret, sender_id, is_active, updated_at FROM sms_settings WHERE is_active=1 LIMIT 1'
    );
    if (!rows.length) return res.status(400).json({ error: 'SMS not configured' });
    const cfg = rows[0];

    let result;
    if (cfg.provider === 'vonage') {
      const fetch = (...a) => import('node-fetch').then(m => m.default(...a)).catch(() => null);
      if (!fetch) return res.status(500).json({ error: 'node-fetch not available' });
      const r = await fetch('https://rest.nexmo.com/sms/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: cfg.api_key, api_secret: cfg.api_secret, to, from: cfg.sender_id, text: message }),
      });
      result = await r.json();
    } else if (cfg.provider === 'infobip') {
      const https = require('https');
      result = await new Promise((resolve) => {
        const body = JSON.stringify({ messages: [{ destinations: [{ to }], from: cfg.sender_id, text: message }] });
        const u = new URL(`https://api.infobip.com/sms/2/text/advanced`);
        const opts = { hostname: u.hostname, path: u.pathname, method: 'POST',
          headers: { 'Authorization': `App ${cfg.api_key}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } };
        const req2 = https.request(opts, r2 => { let d = ''; r2.on('data', c => d += c); r2.on('end', () => resolve(JSON.parse(d))); });
        req2.on('error', e => resolve({ error: e.message }));
        req2.write(body); req2.end();
      });
    } else {
      return res.status(400).json({ error: 'Unknown provider' });
    }

    // Log to activity
    await pool.query('INSERT INTO activity_logs (action, details, created_at) VALUES (?,?,NOW())',
      ['sms_sent', JSON.stringify({ to, provider: cfg.provider })]).catch(() => {});

    res.json({ ok: true, result });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/sms/bulk  — bulk SMS to subscribers or leads
router.post('/api/admin/sms/bulk', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { audience, message, filter } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    let phones = [];
    if (audience === 'subscribers') {
      const [rows] = await pool.query(`SELECT phone FROM subscribers WHERE phone IS NOT NULL AND phone != '' ${filter?.status ? 'AND status=?' : ''} LIMIT 5000`,
        filter?.status ? [filter.status] : []);
      phones = rows.map(r => r.phone);
    } else if (audience === 'leads') {
      const [rows] = await pool.query(`SELECT phone FROM leads WHERE phone IS NOT NULL AND phone != '' ${filter?.status ? 'AND status=?' : ''} LIMIT 5000`,
        filter?.status ? [filter.status] : []);
      phones = rows.map(r => r.phone);
    } else if (Array.isArray(req.body.phones)) {
      phones = req.body.phones;
    }

    if (!phones.length) return res.status(400).json({ error: 'No recipients found' });

    // Queue — send in background, return count immediately
    res.json({ ok: true, queued: phones.length });

    // Background send
    setImmediate(async () => {
      const [rows] = await pool.query(
        'SELECT id, provider, api_key, api_secret, sender_id, is_active, updated_at FROM sms_settings WHERE is_active=1 LIMIT 1'
      ).catch(() => [[]]);
      if (!rows.length) return;
      const cfg = rows[0];
      for (const phone of phones) {
        try {
          await new Promise(r => setTimeout(r, 200)); // throttle
          if (cfg.provider === 'vonage') {
            const https = require('https');
            const body = JSON.stringify({ api_key: cfg.api_key, api_secret: cfg.api_secret, to: phone, from: cfg.sender_id, text: message });
            await new Promise(resolve => {
              const req2 = https.request({ hostname: 'rest.nexmo.com', path: '/sms/json', method: 'POST',
                headers: { 'Content-Type': 'application/json' } }, r2 => { r2.resume(); resolve(); });
              req2.on('error', resolve); req2.write(body); req2.end();
            });
          }
        } catch (_) {}
      }
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Subscription Billing Scheduler ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Ensure subscription_plans table
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS subscription_plans (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      billing_cycle ENUM('monthly','quarterly','yearly') DEFAULT 'monthly',
      description TEXT,
      is_active TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    // subscriber_id is VARCHAR(36) to match subscribers.id — an INT here can never
    // join the (string) subscriber PK. Explicit COLLATE prevents drift on MariaDB
    // (whose server default collation is utf8mb4_uca1400, which breaks cross-table joins).
    await pool.query(`CREATE TABLE IF NOT EXISTS subscriber_subscriptions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      subscriber_id VARCHAR(36) NOT NULL,
      plan_id INT NOT NULL,
      status ENUM('active','paused','cancelled','expired') DEFAULT 'active',
      start_date DATE NOT NULL,
      next_billing_date DATE NOT NULL,
      end_date DATE,
      auto_renew TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_next_billing (next_billing_date),
      INDEX idx_subscriber (subscriber_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (e) { logger.warn('[subscription tables]', e.message); }
})();

// GET /api/admin/subscription-plans
router.get('/api/admin/subscription-plans', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, price, billing_cycle, description, is_active, created_at FROM subscription_plans ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/subscription-plans
router.post('/api/admin/subscription-plans', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, price, billing_cycle = 'monthly', description = '' } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'name and price required' });
    const [r] = await pool.query('INSERT INTO subscription_plans (name, price, billing_cycle, description) VALUES (?,?,?,?)',
      [name, price, billing_cycle, description]);
    res.json({ id: r.insertId, ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/subscription-plans/:id
router.delete('/api/admin/subscription-plans/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM subscription_plans WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/subscriptions  — list active subscriptions
router.get('/api/admin/subscriptions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ss.*, sp.name AS plan_name, sp.price AS plan_price, sp.billing_cycle,
             s.name AS subscriber_name, s.phone AS subscriber_phone, s.client_code
      FROM subscriber_subscriptions ss
      JOIN subscription_plans sp ON sp.id = ss.plan_id
      JOIN subscribers s ON s.id = ss.subscriber_id
      ORDER BY ss.next_billing_date ASC LIMIT 500`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/subscriptions  — assign plan to subscriber
router.post('/api/admin/subscriptions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { subscriber_id, plan_id, start_date, auto_renew = 1 } = req.body;
    if (!subscriber_id || !plan_id) return res.status(400).json({ error: 'subscriber_id and plan_id required' });

    const [[plan]] = await pool.query(
      'SELECT id, name, price, billing_cycle, description, is_active, created_at FROM subscription_plans WHERE id=?',
      [plan_id]
    );
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const start = start_date || new Date().toISOString().slice(0, 10);
    const startMs = new Date(start);
    let next = new Date(startMs);
    if (plan.billing_cycle === 'monthly')    next.setMonth(next.getMonth() + 1);
    else if (plan.billing_cycle === 'quarterly') next.setMonth(next.getMonth() + 3);
    else if (plan.billing_cycle === 'yearly')    next.setFullYear(next.getFullYear() + 1);

    const [r] = await pool.query(
      'INSERT INTO subscriber_subscriptions (subscriber_id, plan_id, start_date, next_billing_date, auto_renew) VALUES (?,?,?,?,?)',
      [subscriber_id, plan_id, start, next.toISOString().slice(0, 10), auto_renew ? 1 : 0]);
    res.json({ id: r.insertId, ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Subscription billing cron — runs daily, generates payment stubs for due subscriptions
setInterval(async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [due] = await pool.query(`
      SELECT ss.*, sp.price, sp.billing_cycle
      FROM subscriber_subscriptions ss
      JOIN subscription_plans sp ON sp.id = ss.plan_id
      WHERE ss.status='active' AND ss.next_billing_date <= ? AND ss.auto_renew=1`, [today]);

    if (due.length > 0) {
      // Batch INSERT payment stubs — atomic: only advance billing dates if INSERT succeeds
      const billingPayRows = due.map(() => `(?, ?, 'subscription', 'pending', ?, NOW())`);
      const billingPayParams = due.flatMap(sub => [sub.subscriber_id, sub.price, `Auto-billing plan: ${sub.plan_id}`]);
      let billingInsertOk = false;
      try {
        await pool.query(
          `INSERT INTO payments (subscriber_id, amount, method, status, notes, created_at) VALUES ${billingPayRows.join(',')}`,
          billingPayParams
        );
        billingInsertOk = true;
      } catch (e) { logger.warn('[subscription billing] payment INSERT failed — billing dates NOT advanced:', e.message); }

      // Only advance next_billing_date if payment stubs were created successfully
      if (billingInsertOk) {
        const billingNextDates = due.map(sub => {
          const next = new Date(sub.next_billing_date);
          if (sub.billing_cycle === 'monthly')       next.setMonth(next.getMonth() + 1);
          else if (sub.billing_cycle === 'quarterly') next.setMonth(next.getMonth() + 3);
          else if (sub.billing_cycle === 'yearly')    next.setFullYear(next.getFullYear() + 1);
          return next.toISOString().slice(0, 10);
        });
        // Chunk to avoid oversized queries (safety cap: 500/chunk)
        const BILLING_CHUNK = 500;
        for (let bi = 0; bi < due.length; bi += BILLING_CHUNK) {
          const bChunk = due.slice(bi, bi + BILLING_CHUNK);
          const bDates = billingNextDates.slice(bi, bi + BILLING_CHUNK);
          const bCaseWhen = bChunk.map(() => 'WHEN id=? THEN ?').join(' ');
          const bCaseParams = bChunk.flatMap((sub, j) => [sub.id, bDates[j]]);
          const bIds = bChunk.map(sub => sub.id);
          await pool.query(
            `UPDATE subscriber_subscriptions SET next_billing_date = CASE ${bCaseWhen} END WHERE id IN (${bIds.map(() => '?').join(',')})`,
            [...bCaseParams, ...bIds]
          ).catch(e => logger.warn('[subscription billing] date update chunk failed:', e.message));
        }
        logger.info(`[subscription billing] processed ${due.length} renewals`);
      }
    }
  } catch (e) { logger.warn('[subscription billing cron]', e.message); }
}, 24 * 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: PDF Invoice Generation (Server-side HTML) ────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/payments/:id/invoice-html  — returns a printable HTML invoice
// Supports ?token=... query param for direct browser access
router.get('/api/admin/payments/:id/invoice-html', async (req, res, next) => {
  // Allow token via query param for direct browser link (invoice printing)
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[payment]] = await pool.query(
      `SELECT p.*, s.name AS client_name, s.phone AS client_phone, s.email AS client_email,
              s.client_code, s.branch
       FROM payments p
       LEFT JOIN subscribers s ON s.id = p.subscriber_id
       WHERE p.id = ?`, [req.params.id]);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const [settingsRows] = await pool.query('SELECT site_name, phone, email FROM settings LIMIT 1').catch(() => [[]]);
    const settings = settingsRows[0] || {};
    const siteName = settings.site_name || 'المعهد النفسي';
    const sitePhone = settings.phone || '';
    const siteEmail = settings.email || '';

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>فاتورة #${payment.id}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Cairo', Arial, sans-serif; background: #fff; color: #1a1a2e; font-size: 14px; }
    .invoice { max-width: 800px; margin: 30px auto; padding: 40px; border: 1px solid #e2e8f0; border-radius: 12px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid #6C63FF; }
    .logo-section h1 { font-size: 28px; color: #6C63FF; font-weight: 700; }
    .logo-section p { color: #64748b; font-size: 13px; margin-top: 4px; }
    .invoice-meta h2 { font-size: 22px; color: #1a1a2e; text-align: left; }
    .invoice-meta p { color: #64748b; font-size: 13px; text-align: left; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
    .party-box { background: #f8fafc; border-radius: 8px; padding: 20px; }
    .party-box h3 { font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
    .party-box p { font-size: 15px; color: #1a1a2e; font-weight: 600; }
    .party-box span { font-size: 13px; color: #64748b; display: block; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #6C63FF; color: #fff; padding: 12px 16px; font-size: 13px; }
    td { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
    tr:last-child td { border-bottom: none; }
    .totals { margin-top: 20px; }
    .total-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .total-row.grand { font-weight: 700; font-size: 18px; color: #6C63FF; border-top: 2px solid #6C63FF; border-bottom: none; padding-top: 12px; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .status-paid { background: #dcfce7; color: #16a34a; }
    .status-pending { background: #fef9c3; color: #ca8a04; }
    .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #f1f5f9; }
    @media print { .invoice { border: none; margin: 0; } }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <div class="logo-section">
        <h1>${siteName}</h1>
        <p>${sitePhone} | ${siteEmail}</p>
      </div>
      <div class="invoice-meta">
        <h2>فاتورة ضريبية</h2>
        <p>رقم الفاتورة: #${payment.id}</p>
        <p>التاريخ: ${new Date(payment.created_at).toLocaleDateString('ar-EG')}</p>
      </div>
    </div>

    <div class="parties">
      <div class="party-box">
        <h3>صادر من</h3>
        <p>${siteName}</p>
        <span>${sitePhone}</span>
        <span>${siteEmail}</span>
      </div>
      <div class="party-box">
        <h3>صادر إلى</h3>
        <p>${payment.client_name || 'عميل'}</p>
        <span>كود: ${payment.client_code || '-'}</span>
        <span>${payment.client_phone || ''}</span>
        <span>${payment.client_email || ''}</span>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>الوصف</th>
          <th>طريقة الدفع</th>
          <th>الحالة</th>
          <th>المبلغ</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${payment.notes || 'خدمات تعليمية'}</td>
          <td>${payment.method || '-'}</td>
          <td>
            <span class="status-badge ${payment.status === 'paid' ? 'status-paid' : 'status-pending'}">
              ${payment.status === 'paid' ? 'مدفوع' : payment.status === 'pending' ? 'معلق' : payment.status}
            </span>
          </td>
          <td><strong>${parseFloat(payment.amount || 0).toLocaleString('ar-EG')} ج.م</strong></td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <div class="total-row"><span>المبلغ الإجمالي</span><span>${parseFloat(payment.amount || 0).toLocaleString('ar-EG')} ج.م</span></div>
      <div class="total-row"><span>الضريبة (0%)</span><span>0 ج.م</span></div>
      <div class="total-row grand"><span>الإجمالي المستحق</span><span>${parseFloat(payment.amount || 0).toLocaleString('ar-EG')} ج.م</span></div>
    </div>

    <div class="footer">
      <p>شكراً لثقتكم في ${siteName} — هذه الفاتورة صادرة إلكترونياً وصالحة بدون توقيع</p>
    </div>
  </div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Advanced Sales Attribution & Conversion Funnel Analytics ─────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/analytics/conversion-funnel?from=&to=
router.get('/api/admin/analytics/conversion-funnel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.from || new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
    const to   = req.query.to   || now.toISOString().slice(0, 10);

    const [byStatus] = await pool.query(`
      SELECT status, COUNT(*) AS cnt FROM leads
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY status`, [from, to]);

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
      FROM leads WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY source ORDER BY cnt DESC`, [from, to]);

    // Staff performance
    const [byStaff] = await pool.query(`
      SELECT st.name AS staff_name,
             COUNT(l.id) AS total_leads,
             SUM(CASE WHEN l.status='converted' THEN 1 ELSE 0 END) AS conversions,
             ROUND(SUM(CASE WHEN l.status='converted' THEN 1 ELSE 0 END) / COUNT(l.id) * 100, 1) AS conv_rate
      FROM leads l
      JOIN staff st ON st.id = l.assigned_to
      WHERE DATE(l.created_at) BETWEEN ? AND ?
      GROUP BY l.assigned_to ORDER BY conversions DESC`, [from, to]);

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
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, SUM(amount) AS revenue
      FROM payments WHERE status='paid' AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY month ORDER BY month`);

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

// Ensure login_history table
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS login_history (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT,
      email VARCHAR(255),
      ip VARCHAR(64),
      user_agent VARCHAR(512),
      status ENUM('success','failed','2fa_pending','2fa_success') DEFAULT 'success',
      failure_reason VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_email (email),
      INDEX idx_created (created_at),
      INDEX idx_status (status)
    )`);
  } catch (e) { logger.warn('[login_history table]', e.message); }
})();

// Helper to log login events — called from login endpoints
async function logLogin(userId, email, req, status, failureReason = null) {
  const ip = (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').split(',')[0].trim();
  const ua = (req.headers['user-agent'] || '').slice(0, 512);
  try {
    await pool.query(
      'INSERT INTO login_history (user_id, email, ip, user_agent, status, failure_reason) VALUES (?,?,?,?,?,?)',
      [userId || null, email || null, ip, ua, status, failureReason]
    );
  } catch (e) { /* non-critical */ }
}

// GET /api/admin/security/login-history?limit=50&email=&status=
router.get('/api/admin/security/login-history', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100'), 500);
    const { email, status } = req.query;
    let sql = 'SELECT id, user_id, email, ip, user_agent, status, failure_reason, created_at FROM login_history WHERE 1=1';
    const params = [];
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
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM login_history WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)');
    const [[{ failed }]] = await pool.query("SELECT COUNT(*) AS failed FROM login_history WHERE status='failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
    const [[{ unique_ips }]] = await pool.query("SELECT COUNT(DISTINCT ip) AS unique_ips FROM login_history WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
    const [suspicious] = await pool.query(`
      SELECT ip, COUNT(*) AS attempts, MAX(created_at) AS last_attempt
      FROM login_history WHERE status='failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY ip HAVING attempts >= 5 ORDER BY attempts DESC LIMIT 20`);
    const [recentLogins] = await pool.query(`
      SELECT email, ip, status, created_at FROM login_history
      ORDER BY created_at DESC LIMIT 20`);
    const [dailyActivity] = await pool.query(`
      SELECT DATE(created_at) AS day,
             SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes,
             SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failures
      FROM login_history WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY day ORDER BY day`);
    res.json({ total: parseInt(total), failed: parseInt(failed), unique_ips: parseInt(unique_ips), suspicious, recentLogins, dailyActivity });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Simpler approach: add a middleware that fires after login and logs
router.use('/api/auth/login', (req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body) => {
    const status = body?.token ? 'success' : body?.requires2fa ? '2fa_pending' : 'failed';
    const reason = body?.error || null;
    logLogin(body?.userId || null, req.body?.email, req, status, reason).catch(() => {});
    return origJson(body);
  };
  next();
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Scheduled Daily Email Report ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

async function sendDailyReport() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const [[{ revenue }]] = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS revenue FROM payments WHERE status='paid' AND DATE(created_at)=?`, [today]);
    const [[{ new_leads }]] = await pool.query(
      `SELECT COUNT(*) AS new_leads FROM leads WHERE DATE(created_at)=?`, [today]);
    const [[{ new_clients }]] = await pool.query(
      `SELECT COUNT(*) AS new_clients FROM subscribers WHERE DATE(created_at)=?`, [today]);
    const [[{ pending_payments }]] = await pool.query(
      `SELECT COUNT(*) AS pending_payments FROM payments WHERE status='pending'`);
    const [[{ failed_logins }]] = await pool.query(
      `SELECT COUNT(*) AS failed_logins FROM login_history WHERE status='failed' AND DATE(created_at)=?`, [today]).catch(() => [[{ failed_logins: 0 }]]);
    const [[{ month_revenue }]] = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS month_revenue FROM payments WHERE status='paid' AND DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(NOW(),'%Y-%m')`);

    // Get admin emails from DB settings
    const [adminStaff] = await pool.query(`SELECT email FROM staff WHERE UPPER(role)='ADMIN' AND email IS NOT NULL LIMIT 5`).catch(() => [[]]);

    if (!adminStaff.length) return;

    const smtpSettings = await pool.query("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from') LIMIT 10")
      .then(([rows]) => Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value])))
      .catch(() => ({}));

    if (!smtpSettings.smtp_host || !smtpSettings.smtp_user) {
      // Try from env
      if (!process.env.SMTP_HOST) return;
    }

    const transporter = require('nodemailer').createTransport({
      host: smtpSettings.smtp_host || process.env.SMTP_HOST,
      port: parseInt(smtpSettings.smtp_port || process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: smtpSettings.smtp_user || process.env.SMTP_USER,
        pass: smtpSettings.smtp_pass || process.env.SMTP_PASS,
      },
    });

    const html = `
      <div dir="rtl" style="font-family:Cairo,Arial,sans-serif;max-width:600px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#6C63FF;margin-bottom:4px;">📊 التقرير اليومي — ${today}</h2>
        <p style="color:#64748b;font-size:13px;margin-bottom:24px;">ملخص أداء المعهد النفسي</p>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="background:#6C63FF;color:#fff;">
            <th style="padding:10px;text-align:right;">المؤشر</th>
            <th style="padding:10px;text-align:right;">اليوم</th>
          </tr>
          <tr style="background:#fff;"><td style="padding:10px;border-bottom:1px solid #f1f5f9;">💰 الإيرادات</td><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:bold;color:#16a34a;">${Number(revenue).toLocaleString('ar-EG')} ج.م</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:10px;border-bottom:1px solid #f1f5f9;">👥 عملاء محتملون جدد</td><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:bold;">${new_leads}</td></tr>
          <tr style="background:#fff;"><td style="padding:10px;border-bottom:1px solid #f1f5f9;">✅ عملاء مسجلون جدد</td><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:bold;">${new_clients}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:10px;border-bottom:1px solid #f1f5f9;">⏳ مدفوعات معلقة</td><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:bold;color:#d97706;">${pending_payments}</td></tr>
          <tr style="background:#fff;"><td style="padding:10px;border-bottom:1px solid #f1f5f9;">🔴 محاولات دخول فاشلة</td><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:bold;color:${failed_logins >= 10 ? '#dc2626' : '#374151'};">${failed_logins}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:10px;">📈 إيرادات الشهر الحالي</td><td style="padding:10px;font-weight:bold;color:#6C63FF;">${Number(month_revenue).toLocaleString('ar-EG')} ج.م</td></tr>
        </table>
        <p style="color:#94a3b8;font-size:11px;margin-top:20px;text-align:center;">تم الإرسال تلقائياً من النظام — المعهد النفسي</p>
      </div>`;

    for (const admin of adminStaff) {
      await transporter.sendMail({
        from: smtpSettings.smtp_from || smtpSettings.smtp_user || process.env.SMTP_USER,
        to: admin.email,
        subject: `📊 تقرير يومي — ${today} | المعهد النفسي`,
        html,
      }).catch(e => logger.warn('[daily-report] send error:', e.message));
    }
    logger.info(`[daily-report] sent to ${adminStaff.length} admin(s)`);
  } catch (e) { logger.warn('[daily-report] error:', e.message); }
}

// Schedule: every day at 7:00 AM server time
function scheduleDailyReport() {
  const now = new Date();
  const next7am = new Date(now);
  next7am.setHours(7, 0, 0, 0);
  if (next7am <= now) next7am.setDate(next7am.getDate() + 1);
  const msUntil = next7am - now;
  setTimeout(() => {
    sendDailyReport();
    setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
  }, msUntil);
  logger.info(`[daily-report] scheduled — next run in ${Math.round(msUntil / 3600000)}h`);
}
scheduleDailyReport();

// GET /api/admin/reports/daily-preview — preview what the daily report would look like
router.get('/api/admin/reports/daily-preview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const today = req.query.date || new Date().toISOString().slice(0, 10);
    const [[{ revenue }]] = await pool.query(`SELECT COALESCE(SUM(amount),0) AS revenue FROM payments WHERE status='paid' AND DATE(created_at)=?`, [today]);
    const [[{ new_leads }]] = await pool.query(`SELECT COUNT(*) AS new_leads FROM leads WHERE DATE(created_at)=?`, [today]);
    const [[{ new_clients }]] = await pool.query(`SELECT COUNT(*) AS new_clients FROM subscribers WHERE DATE(created_at)=?`, [today]);
    const [[{ pending_payments }]] = await pool.query(`SELECT COUNT(*) AS pending_payments FROM payments WHERE status='pending'`);
    const [[{ failed_logins }]] = await pool.query(`SELECT COUNT(*) AS failed_logins FROM login_history WHERE status='failed' AND DATE(created_at)=?`, [today]).catch(() => [[{ failed_logins: 0 }]]);
    const [[{ month_revenue }]] = await pool.query(`SELECT COALESCE(SUM(amount),0) AS month_revenue FROM payments WHERE status='paid' AND DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(NOW(),'%Y-%m')`);
    res.json({ date: today, revenue: parseFloat(revenue), new_leads: parseInt(new_leads), new_clients: parseInt(new_clients), pending_payments: parseInt(pending_payments), failed_logins: parseInt(failed_logins), month_revenue: parseFloat(month_revenue) });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/reports/send-now — manually trigger the daily report
router.post('/api/admin/reports/send-now', requireAuth, requireAdmin, async (req, res) => {
  try {
    await sendDailyReport();
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
      LEFT JOIN payments p ON p.subscriber_id = s.id AND p.status = 'paid'
      WHERE s.status NOT IN ('inactive','cancelled')
      GROUP BY s.id
      HAVING (last_payment_date IS NULL OR last_payment_date < ?)
      ORDER BY days_since_payment DESC NULLS LAST
      LIMIT 500`, [cutoffStr]);

    // Retention rate: active clients with recent payment / all active
    const [[{ total_active }]] = await pool.query(`SELECT COUNT(*) AS total_active FROM subscribers WHERE status NOT IN ('inactive','cancelled')`);
    const atRisk = inactive.length;
    const retentionRate = total_active > 0 ? Math.round((1 - atRisk / parseInt(total_active)) * 100) : 100;

    // Monthly cohort retention (new clients per month who are still active)
    const [cohorts] = await pool.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS cohort,
             COUNT(*) AS total,
             SUM(CASE WHEN status NOT IN ('inactive','cancelled') THEN 1 ELSE 0 END) AS still_active
      FROM subscribers
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY cohort ORDER BY cohort`);

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
             (SELECT MAX(p.created_at) FROM payments p WHERE p.subscriber_id = s.id AND p.status='paid') AS last_payment,
             (SELECT COUNT(*) FROM payments p WHERE p.subscriber_id = s.id AND p.status='pending') AS pending_count
      FROM subscribers s
      WHERE s.status NOT IN ('inactive','cancelled')
      HAVING (last_payment IS NULL OR DATEDIFF(NOW(), last_payment) > 45) OR pending_count > 0
      ORDER BY pending_count DESC, last_payment ASC
      LIMIT 200`);

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
          SELECT SUM(p.amount) FROM payments p
          JOIN subscribers sub ON sub.id = p.subscriber_id
          WHERE sub.assigned_to = st.id AND p.status='paid' AND DATE(p.created_at) BETWEEN ? AND ?
        ), 0) AS revenue_generated,
        -- Tasks completed
        COUNT(DISTINCT CASE WHEN t.status='done' THEN t.id END) AS tasks_done,
        COUNT(DISTINCT t.id) AS tasks_total
      FROM staff st
      LEFT JOIN leads l ON l.assigned_to = st.id AND DATE(l.created_at) BETWEEN ? AND ?
      LEFT JOIN subscribers s ON s.assigned_to = st.id AND DATE(s.created_at) BETWEEN ? AND ?
      LEFT JOIN tasks t ON t.assigned_to = st.id AND DATE(t.created_at) BETWEEN ? AND ?
      WHERE st.is_active = 1
      GROUP BY st.id
      ORDER BY revenue_generated DESC`,
      [from, to, from, to, from, to, from, to]
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
      SELECT category, COUNT(*) AS count, SUM(amount) AS total
      FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ?
      GROUP BY category ORDER BY total DESC`, [from, to]);

    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(date,'%Y-%m') AS month, category, SUM(amount) AS total
      FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ?
      GROUP BY month, category ORDER BY month, total DESC`, [from, to]);

    const [[{ grand_total }]] = await pool.query(`SELECT COALESCE(SUM(amount),0) AS grand_total FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`, [from, to]);

    res.json({
      period: { from, to },
      grandTotal: parseFloat(grand_total),
      byCategory: byCategory.map(r => ({ ...r, total: parseFloat(r.total), pct: grand_total > 0 ? Math.round(r.total / grand_total * 100) : 0 })),
      monthly,
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Notification Center ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Ensure admin_notifications table
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_notifications (
      id INT PRIMARY KEY AUTO_INCREMENT,
      type VARCHAR(50) NOT NULL COMMENT 'alert|info|warning|success',
      title VARCHAR(255) NOT NULL,
      message TEXT,
      link VARCHAR(512),
      is_read TINYINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_read (is_read),
      INDEX idx_created (created_at)
    )`);
  } catch (e) { logger.warn('[admin_notifications]', e.message); }
})();

// Push a notification
async function pushAdminNotif(type, title, message, link = null) {
  try {
    await pool.query('INSERT INTO admin_notifications (type, title, message, link) VALUES (?,?,?,?)', [type, title, message, link]);
  } catch (e) { /* non-critical */ }
}

// GET /api/admin/notifications/inbox?unread_only=1
router.get('/api/admin/notifications/inbox', requireAuth, requireAdmin, async (req, res) => {
  try {
    const unreadOnly = req.query.unread_only === '1';
    const [rows] = await pool.query(
      `SELECT id, type, title, message, link, is_read, created_at
       FROM admin_notifications ${unreadOnly ? 'WHERE is_read=0' : ''} ORDER BY created_at DESC LIMIT 100`
    );
    const [[{ unread_count }]] = await pool.query('SELECT COUNT(*) AS unread_count FROM admin_notifications WHERE is_read=0');
    res.json({ notifications: rows, unread_count: parseInt(unread_count) });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/notifications/read-all
router.put('/api/admin/notifications/read-all', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE admin_notifications SET is_read=1 WHERE is_read=0');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/notifications/:id
router.delete('/api/admin/notifications/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM admin_notifications WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Auto-trigger notifications on important events via cron (daily check)
setInterval(async () => {
  try {
    // Check for pending payments > 3 days old
    const [[{ old_pending }]] = await pool.query(
      `SELECT COUNT(*) AS old_pending FROM payments WHERE status='pending' AND created_at < DATE_SUB(NOW(), INTERVAL 3 DAY)`
    );
    if (parseInt(old_pending) > 0) {
      await pushAdminNotif('warning', 'مدفوعات معلقة', `يوجد ${old_pending} مدفوعة معلقة منذ أكثر من 3 أيام`, '/dashboard?tab=orders');
    }

    // Check for high churn risk clients
    const [[{ at_risk }]] = await pool.query(
      `SELECT COUNT(*) AS at_risk FROM subscribers s WHERE s.status NOT IN ('inactive','cancelled') AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.subscriber_id=s.id AND p.status='paid' AND p.created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY))`
    );
    if (parseInt(at_risk) >= 5) {
      await pushAdminNotif('alert', 'خطر انسحاب العملاء', `${at_risk} عميل لم يدفع منذ 60 يوماً`, '/dashboard?tab=retention');
    }

    // Check for failed login spikes
    const [[{ fail_count }]] = await pool.query(
      `SELECT COUNT(*) AS fail_count FROM login_history WHERE status='failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`
    ).catch(() => [[{ fail_count: 0 }]]);
    if (parseInt(fail_count) >= 10) {
      await pushAdminNotif('alert', 'تنبيه أمني', `${fail_count} محاولة دخول فاشلة خلال آخر ساعة`);
    }
  } catch (e) { /* non-critical */ }
}, 6 * 60 * 60 * 1000); // every 6 hours

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Daily Follow-up Reminders (Leads) ────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Ensure reminder_log table to avoid duplicate sends
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS reminder_log (
      id INT PRIMARY KEY AUTO_INCREMENT,
      type ENUM('followup','payment_due') NOT NULL,
      ref_id VARCHAR(64) NOT NULL,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_type_ref_day (type, ref_id, sent_at)
    )`);
  } catch (e) { logger.warn('[reminder_log]', e.message); }
})();

async function runFollowUpReminders() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Leads due for follow-up today
    const [leads] = await pool.query(`
      SELECT l.id, l.name, l.phone, l.email,
             l.next_follow_up_date, l.status, l.source,
             st.name AS staff_name, st.phone AS staff_phone, st.email AS staff_email
      FROM leads l
      LEFT JOIN staff st ON st.id = l.assigned_to
      WHERE DATE(l.next_follow_up_date) = ?
        AND l.status NOT IN ('converted','disqualified','archived')
      LIMIT 100`, [today]);

    let sent = 0;
    // Batch-check which leads were already reminded today (1 query instead of N)
    const _fuKeys = leads.map(l => `followup_${l.id}_${today}`);
    const [_fuSentRows] = leads.length ? await pool.query(
      `SELECT ref_id FROM reminder_log WHERE type='followup' AND ref_id IN (${_fuKeys.map(() => '?').join(',')}) AND DATE(sent_at)=?`,
      [..._fuKeys, today]
    ).catch(() => [[]]) : [[]];
    const _fuDone = new Set(_fuSentRows.map(r => r.ref_id));
    for (const lead of leads) {
      const logKey = `followup_${lead.id}_${today}`;
      if (_fuDone.has(logKey)) continue;

      // WhatsApp to assigned staff
      if (lead.staff_phone) {
        const msg = `🔔 تذكير متابعة\nالعميل المحتمل: ${lead.name}\nالهاتف: ${lead.phone || '—'}\nالمصدر: ${lead.source || '—'}\nالحالة: ${lead.status || '—'}\n\nيرجى التواصل اليوم 📞`;
        sendWhatsApp(lead.staff_phone.replace(/\D/g, ''), msg).catch(() => {});
      }

      // Email to assigned staff
      if (lead.staff_email) {
        mailer.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: lead.staff_email,
          subject: `🔔 تذكير متابعة — ${lead.name}`,
          html: `<div dir="rtl" style="font-family:Arial;padding:16px;background:#f8fafc;border-radius:8px;">
            <h3 style="color:#6C63FF;">تذكير متابعة عميل محتمل</h3>
            <table style="border-collapse:collapse;width:100%">
              <tr><td style="padding:6px 12px;font-weight:bold;">الاسم</td><td style="padding:6px 12px;">${lead.name}</td></tr>
              <tr style="background:#fff"><td style="padding:6px 12px;font-weight:bold;">الهاتف</td><td style="padding:6px 12px;">${lead.phone || '—'}</td></tr>
              <tr><td style="padding:6px 12px;font-weight:bold;">الحالة</td><td style="padding:6px 12px;">${lead.status || '—'}</td></tr>
              <tr style="background:#fff"><td style="padding:6px 12px;font-weight:bold;">المصدر</td><td style="padding:6px 12px;">${lead.source || '—'}</td></tr>
            </table>
            <p style="color:#94a3b8;font-size:12px;margin-top:16px;">أُرسل تلقائياً — المعهد النفسي</p>
          </div>`,
        }).catch(() => {});
      }

      // Push admin notification
      pushAdminNotif('info', `تذكير متابعة: ${lead.name}`,
        `موعد متابعة ${lead.name} (${lead.staff_name || 'غير محدد'}) — اليوم`,
        '/dashboard?tab=leads'
      ).catch(() => {});

      // Log to avoid re-send
      pool.query(`INSERT IGNORE INTO reminder_log (type, ref_id) VALUES ('followup', ?)`, [logKey]).catch(() => {});
      sent++;
    }
    if (sent > 0) logger.info(`[followup-reminders] sent ${sent} reminder(s) for ${today}`);
  } catch (e) { logger.warn('[followup-reminders] error:', e.message); }
}

// Run daily at 8:00 AM
function scheduleFollowUpReminders() {
  const now = new Date();
  const next8am = new Date(now);
  next8am.setHours(8, 0, 0, 0);
  if (next8am <= now) next8am.setDate(next8am.getDate() + 1);
  const ms = next8am - now;
  setTimeout(() => {
    runFollowUpReminders();
    setInterval(runFollowUpReminders, 24 * 60 * 60 * 1000);
  }, ms);
  logger.info(`[followup-reminders] scheduled — next run in ${Math.round(ms / 3600000)}h`);
}
scheduleFollowUpReminders();

// GET /api/admin/leads/due-today — list leads due for follow-up today
router.get('/api/admin/leads/due-today', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [leads] = await pool.query(`
      SELECT l.id, l.name, l.phone, l.email, l.status, l.source,
             l.next_follow_up_date, l.assigned_to,
             st.name AS staff_name
      FROM leads l
      LEFT JOIN staff st ON st.id = l.assigned_to
      WHERE DATE(l.next_follow_up_date) = ?
        AND l.status NOT IN ('converted','disqualified','archived')
      ORDER BY l.name`, [today]);
    res.json({ date: today, count: leads.length, leads });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/leads/reminders/send-now — manually trigger follow-up reminders
router.post('/api/admin/leads/reminders/send-now', requireAuth, requireAdmin, async (req, res) => {
  try {
    await runFollowUpReminders();
    res.json({ ok: true, message: 'تم إرسال تذكيرات المتابعة' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Payment Due Reminders (Subscribers) ──────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

async function runPaymentDueReminders() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const in3days = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const in1day  = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);

    // Find pending installment payments coming due
    const [pending] = await pool.query(`
      SELECT p.id, p.subscriber_id, p.amount, p.currency, p.date AS due_date,
             s.name, s.phone, s.email, s.client_code
      FROM payments p
      JOIN subscribers s ON s.id = p.subscriber_id
      WHERE p.status = 'pending'
        AND p.is_installment = 1
        AND DATE(p.date) IN (?, ?)
      LIMIT 200`, [in3days, in1day]);

    let sent = 0;
    // Batch-check which payments were already reminded today (1 query instead of N)
    const _pdKeys = pending.map(p => `payment_due_${p.id}_${today}`);
    const [_pdSentRows] = pending.length ? await pool.query(
      `SELECT ref_id FROM reminder_log WHERE type='payment_due' AND ref_id IN (${_pdKeys.map(() => '?').join(',')}) AND DATE(sent_at)=?`,
      [..._pdKeys, today]
    ).catch(() => [[]]) : [[]];
    const _pdDone = new Set(_pdSentRows.map(r => r.ref_id));
    for (const p of pending) {
      const logKey = `payment_due_${p.id}_${today}`;
      if (_pdDone.has(logKey)) continue;

      const daysLeft = Math.round((new Date(p.due_date) - new Date(today)) / 86400000);
      const amountFmt = `${Number(p.amount).toLocaleString('ar-EG')} ${p.currency || 'ج.م'}`;

      // WhatsApp to client
      if (p.phone) {
        const msg = `مرحباً ${p.name} 👋\nهذا تذكير بموعد دفعتك القادمة:\n💰 المبلغ: ${amountFmt}\n📅 الموعد: ${p.due_date} (خلال ${daysLeft} يوم${daysLeft === 1 ? '' : 'أ'})\n\nشكراً لثقتك في معهد مهاد 💚`;
        sendWhatsApp(p.phone.replace(/\D/g, ''), msg).catch(() => {});
      }

      // Email to client
      if (p.email) {
        mailer.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: p.email,
          subject: `تذكير بموعد الدفع — ${p.due_date}`,
          html: `<div dir="rtl" style="font-family:Cairo,Arial;max-width:500px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
            <h3 style="color:#6C63FF;">تذكير بموعد دفعة</h3>
            <p>مرحباً <strong>${p.name}</strong>،</p>
            <p>نودّ تذكيرك بموعد دفعتك القادمة:</p>
            <div style="background:#fff;border-radius:8px;padding:16px;border:1px solid #e2e8f0;">
              <p>💰 <strong>المبلغ:</strong> ${amountFmt}</p>
              <p>📅 <strong>تاريخ الاستحقاق:</strong> ${p.due_date}</p>
              <p>⏳ <strong>المتبقي:</strong> ${daysLeft} يوم</p>
            </div>
            <p style="margin-top:16px;">شكراً لثقتك في <strong>معهد مهاد للدراسات النفسية</strong> 💚</p>
            <p style="color:#94a3b8;font-size:11px;">أُرسل تلقائياً</p>
          </div>`,
        }).catch(() => {});
      }

      pool.query(`INSERT IGNORE INTO reminder_log (type, ref_id) VALUES ('payment_due', ?)`, [logKey]).catch(() => {});
      sent++;
    }
    if (sent > 0) logger.info(`[payment-reminders] sent ${sent} reminder(s)`);
  } catch (e) { logger.warn('[payment-reminders] error:', e.message); }
}

// Run daily at 9:00 AM
function schedulePaymentReminders() {
  const now = new Date();
  const next9am = new Date(now);
  next9am.setHours(9, 0, 0, 0);
  if (next9am <= now) next9am.setDate(next9am.getDate() + 1);
  const ms = next9am - now;
  setTimeout(() => {
    runPaymentDueReminders();
    setInterval(runPaymentDueReminders, 24 * 60 * 60 * 1000);
  }, ms);
  logger.info(`[payment-reminders] scheduled — next run in ${Math.round(ms / 3600000)}h`);
}
schedulePaymentReminders();

// GET /api/admin/payments/due-upcoming?days=7 — payments due soon
router.get('/api/admin/payments/due-upcoming', requireAuth, requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days || '7');
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const [rows] = await pool.query(`
      SELECT p.id, p.amount, p.currency, p.date AS due_date,
             DATEDIFF(p.date, CURDATE()) AS days_left,
             s.id AS subscriber_id, s.name, s.phone, s.client_code, s.branch
      FROM payments p
      JOIN subscribers s ON s.id = p.subscriber_id
      WHERE p.status = 'pending'
        AND DATE(p.date) BETWEEN ? AND ?
      ORDER BY p.date ASC
      LIMIT 200`, [today, future]);
    res.json({ from: today, to: future, count: rows.length, payments: rows });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/payments/reminders/send-now — manually trigger payment reminders
router.post('/api/admin/payments/reminders/send-now', requireAuth, requireAdmin, async (req, res) => {
  try {
    await runPaymentDueReminders();
    res.json({ ok: true, message: 'تم إرسال تذكيرات الدفع' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Revenue Source Breakdown ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/analytics/revenue-sources?from=&to=
router.get('/api/admin/analytics/revenue-sources', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.from || new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    const to   = req.query.to   || now.toISOString().slice(0, 10);

    // By payment_type
    const [byType] = await pool.query(`
      SELECT COALESCE(payment_type, 'other') AS source,
             COUNT(*) AS transactions, SUM(amount) AS total
      FROM payments WHERE status='paid' AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY source ORDER BY total DESC`, [from, to]);

    // Monthly breakdown by source
    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(created_at,'%Y-%m') AS month,
             COALESCE(payment_type, 'other') AS source,
             SUM(amount) AS total
      FROM payments WHERE status='paid' AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY month, source ORDER BY month, total DESC`, [from, to]);

    // Top paying clients
    const [topClients] = await pool.query(`
      SELECT s.id, s.name, s.phone, s.branch, s.client_code,
             SUM(p.amount) AS total_paid, COUNT(p.id) AS payment_count
      FROM payments p JOIN subscribers s ON s.id = p.subscriber_id
      WHERE p.status='paid' AND DATE(p.created_at) BETWEEN ? AND ?
      GROUP BY s.id ORDER BY total_paid DESC LIMIT 20`, [from, to]);

    // By branch
    const [byBranch] = await pool.query(`
      SELECT COALESCE(s.branch,'غير محدد') AS branch,
             SUM(p.amount) AS total, COUNT(p.id) AS count
      FROM payments p JOIN subscribers s ON s.id = p.subscriber_id
      WHERE p.status='paid' AND DATE(p.created_at) BETWEEN ? AND ?
      GROUP BY branch ORDER BY total DESC`, [from, to]);

    const [[{ grand_total }]] = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS grand_total FROM payments WHERE status='paid' AND DATE(created_at) BETWEEN ? AND ?`,
      [from, to]
    );

    const sourceLabel = {
      course: 'كورسات', consultation: 'استشارات', daqqi: 'دقيقي',
      book: 'كتب', certificate: 'شهادات', subscription: 'اشتراكات', other: 'أخرى',
    };

    res.json({
      period: { from, to },
      grandTotal: parseFloat(grand_total),
      byType: byType.map((r) => ({
        source: r.source,
        label: sourceLabel[r.source] || r.source,
        total: parseFloat(r.total),
        transactions: parseInt(r.transactions),
        pct: grand_total > 0 ? Math.round(r.total / grand_total * 100) : 0,
      })),
      monthly,
      topClients: topClients.map((c) => ({ ...c, total_paid: parseFloat(c.total_paid) })),
      byBranch: byBranch.map((b) => ({ ...b, total: parseFloat(b.total), pct: grand_total > 0 ? Math.round(b.total / grand_total * 100) : 0 })),
    });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Automation Dashboard ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/automation/stats — overview of all automations
router.get('/api/admin/automation/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [[{ followup_due }]] = await pool.query(
      `SELECT COUNT(*) AS followup_due FROM leads WHERE DATE(next_follow_up_date) = ? AND status NOT IN ('converted','disqualified','archived')`, [today]);
    const [[{ followup_overdue }]] = await pool.query(
      `SELECT COUNT(*) AS followup_overdue FROM leads WHERE next_follow_up_date < ? AND status NOT IN ('converted','disqualified','archived')`, [today]);
    const [[{ payment_due_3d }]] = await pool.query(
      `SELECT COUNT(*) AS payment_due_3d FROM payments WHERE status='pending' AND is_installment=1 AND DATE(date) BETWEEN ? AND DATE_ADD(?, INTERVAL 3 DAY)`, [today, today]);
    const [[{ payment_overdue }]] = await pool.query(
      `SELECT COUNT(*) AS payment_overdue FROM payments WHERE status='pending' AND is_installment=1 AND DATE(date) < ?`, [today]);
    const [[{ reminders_sent_today }]] = await pool.query(
      `SELECT COUNT(*) AS reminders_sent_today FROM reminder_log WHERE DATE(sent_at) = ?`, [today]).catch(() => [[{ reminders_sent_today: 0 }]]);
    const [[{ drip_active }]] = await pool.query(
      `SELECT COUNT(*) AS drip_active FROM drip_campaigns WHERE is_active=1`).catch(() => [[{ drip_active: 0 }]]);
    const [[{ workflows_active }]] = await pool.query(
      `SELECT COUNT(*) AS workflows_active FROM workflows WHERE is_active=1`).catch(() => [[{ workflows_active: 0 }]]);

    res.json({
      followup_due: parseInt(followup_due),
      followup_overdue: parseInt(followup_overdue),
      payment_due_3d: parseInt(payment_due_3d),
      payment_overdue: parseInt(payment_overdue),
      reminders_sent_today: parseInt(reminders_sent_today),
      drip_campaigns_active: parseInt(drip_active),
      workflows_active: parseInt(workflows_active),
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Global Search ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/search', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ subscribers: [], leads: [], consultations: [] });
    const like = `%${q}%`;

    const [subscribers] = await pool.query(
      `SELECT id, client_code, name, email, phone, branch, is_active, created_at
       FROM subscribers WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR client_code LIKE ?
       ORDER BY created_at DESC LIMIT 10`,
      [like, like, like, like]
    );

    const [leads] = await pool.query(
      `SELECT id, client_code, name, email, phone, status, source, created_at
       FROM leads WHERE (name LIKE ? OR email LIKE ? OR phone LIKE ? OR client_code LIKE ?) AND hidden=0
       ORDER BY created_at DESC LIMIT 10`,
      [like, like, like, like]
    );

    const [consultations] = await pool.query(
      `SELECT c.id, c.client_name, c.client_email, c.client_phone, c.session_date, c.status,
              t.name AS therapist_name
       FROM consultations c LEFT JOIN therapists t ON t.id=c.therapist_id
       WHERE c.client_name LIKE ? OR c.client_email LIKE ? OR c.client_phone LIKE ?
       ORDER BY c.session_date DESC LIMIT 5`,
      [like, like, like]
    );

    res.json({ subscribers, leads, consultations });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Consultation Calendar ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/consultations/calendar', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
    const [rows] = await pool.query(
      `SELECT c.id, c.client_name, c.session_date, c.status, c.session_type,
              c.amount, c.currency, c.meeting_link,
              t.name AS therapist_name, t.image AS therapist_image
       FROM consultations c
       LEFT JOIN therapists t ON t.id = c.therapist_id
       WHERE DATE_FORMAT(c.session_date, '%Y-%m') = ?
       ORDER BY c.session_date ASC`,
      [month]
    );
    // Group by date
    const grouped = {};
    for (const r of rows) {
      const d = r.session_date instanceof Date
        ? r.session_date.toISOString().slice(0, 10)
        : String(r.session_date).slice(0, 10);
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(r);
    }
    res.json({ month, grouped, total: rows.length });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Session Notes (add/edit note on consultation) ───────────────
// ═══════════════════════════════════════════════════════════════════════════
router.put('/api/admin/consultations/:id/notes', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { notes, status } = req.body;
    const sets = [];
    const vals = [];
    if (notes !== undefined) { sets.push('notes=?'); vals.push(notes); }
    if (status) { sets.push('status=?'); vals.push(status); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await pool.query(`UPDATE consultations SET ${sets.join(',')} WHERE id=?`, vals);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Bulk NPS send ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
router.post('/api/admin/nps/send-bulk', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Send NPS to all active subscribers who haven't received one in 30 days
    const [subs] = await pool.query(
      `SELECT s.id, s.email, s.name FROM subscribers s
       WHERE s.is_active=1 AND s.email IS NOT NULL AND s.email != ''
         AND NOT EXISTS (
           SELECT 1 FROM nps_responses n
           WHERE n.subscriber_id = s.id AND n.sent_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
         )
       LIMIT 100`
    );
    let sent = 0;
    if (subs.length > 0) {
      // Batch-insert all NPS records in one query (avoid N+1 per subscriber)
      const npsIds = subs.map(() => uuidv4());
      const insertVals = subs.map((sub, i) => [npsIds[i], sub.id, sub.email]);
      await pool.query(
        'INSERT INTO nps_responses (id, subscriber_id, subscriber_email, sent_at) VALUES ?',
        [insertVals]
      );
      // Send emails (fire-and-forget, failures logged)
      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        const link = `https://mahadnafsy.com/nps?id=${npsIds[i]}`;
        sendEmail(sub.email, 'كيف تقيّم تجربتك مع معهد الدراسات النفسية؟',
          `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h2 style="color:#7c3aed">مرحباً ${sub.name || ''}،</h2>
            <p>رأيك يهمنا جداً. قيّم تجربتك معنا من 0 إلى 10:</p>
            <div style="text-align:center;margin:24px 0">
              <a href="${link}" style="background:#7c3aed;color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:bold">قيّم الآن ⭐</a>
            </div>
            <p style="color:#9ca3af;font-size:12px;text-align:center">معهد الدراسات النفسية — mahadnafsy.com</p>
          </div>`
        ).catch(() => {});
        sent++;
      }
    }
    res.json({ ok: true, sent });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: System Configuration (Dynamic Branches, Currencies, etc.) ───
// ═══════════════════════════════════════════════════════════════════════════

// Helper to get system config section
async function getSysConfig(section) {
  const [[row]] = await pool.query("SELECT `value` FROM site_config WHERE `key`=? LIMIT 1", [`sys_${section}`]);
  return row?.value ? JSON.parse(row.value) : null;
}
// Helper to save system config section
async function setSysConfig(section, value) {
  await pool.query(
    "INSERT INTO site_config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
    [`sys_${section}`, JSON.stringify(value)]
  );
}

// Default system config (used when nothing saved yet)
const SYS_DEFAULTS = {
  branches: [
    { key: 'DAQQI',        label: 'دقي',               is_active: true },
    { key: 'TAGAMOA',      label: 'التجمع الخامس',      is_active: true },
    { key: 'ONLINE_EGYPT', label: 'أونلاين - مصر',      is_active: true },
    { key: 'ONLINE_SAUDI', label: 'أونلاين - السعودية', is_active: true },
    { key: 'ONLINE_ABROAD', label: 'أونلاين - الخارج',  is_active: true },
    { key: 'OTHER',        label: 'أخرى',               is_active: true },
  ],
  currencies: [
    { code: 'EGP', symbol: 'ج.م', name: 'جنيه مصري',    is_default: true,  is_active: true },
    { code: 'SAR', symbol: 'ر.س', name: 'ريال سعودي',   is_default: false, is_active: true },
    { code: 'USD', symbol: '$',   name: 'دولار أمريكي', is_default: false, is_active: true },
    { code: 'EUR', symbol: '€',   name: 'يورو',          is_default: false, is_active: false },
  ],
  countries: [
    { code: 'EG', name: 'مصر',        flag: '🇪🇬', is_active: true },
    { code: 'SA', name: 'السعودية',   flag: '🇸🇦', is_active: true },
    { code: 'AE', name: 'الإمارات',   flag: '🇦🇪', is_active: true },
    { code: 'KW', name: 'الكويت',     flag: '🇰🇼', is_active: true },
    { code: 'QA', name: 'قطر',        flag: '🇶🇦', is_active: true },
    { code: 'JO', name: 'الأردن',     flag: '🇯🇴', is_active: true },
    { code: 'LB', name: 'لبنان',      flag: '🇱🇧', is_active: true },
    { code: 'MA', name: 'المغرب',     flag: '🇲🇦', is_active: true },
    { code: 'SD', name: 'السودان',    flag: '🇸🇩', is_active: true },
    { code: 'OTHER', name: 'أخرى',   flag: '🌍', is_active: true },
  ],
  payment_methods: [
    { key: 'cash',          label: 'كاش',              icon: '💵', is_active: true },
    { key: 'visa',          label: 'فيزا / بطاقة',     icon: '💳', is_active: true },
    { key: 'instapay',      label: 'إنستاباي',         icon: '📱', is_active: true },
    { key: 'bank_transfer', label: 'تحويل بنكي',       icon: '🏦', is_active: true },
    { key: 'paymob',        label: 'PayMob',            icon: '🔌', is_active: false },
    { key: 'vodafone_cash', label: 'فودافون كاش',      icon: '📲', is_active: true },
    { key: 'other',         label: 'أخرى',             icon: '📦', is_active: true },
  ],
  session_types: [
    { key: 'INDIVIDUAL', label: 'فردي',    is_active: true },
    { key: 'COUPLE',     label: 'زوجي',    is_active: true },
    { key: 'FAMILY',     label: 'عائلي',   is_active: true },
    { key: 'GROUP',      label: 'جماعي',   is_active: false },
  ],
  lead_sources: [
    { key: 'facebook',    label: 'فيسبوك',       is_active: true },
    { key: 'instagram',   label: 'إنستجرام',     is_active: true },
    { key: 'website',     label: 'الموقع',       is_active: true },
    { key: 'referral',    label: 'توصية',         is_active: true },
    { key: 'whatsapp',    label: 'واتساب',        is_active: true },
    { key: 'call',        label: 'اتصال مباشر',  is_active: true },
    { key: 'other',       label: 'أخرى',         is_active: true },
  ],
  expense_categories: [
    { key: 'rent',        label: 'إيجار',        is_active: true },
    { key: 'salaries',    label: 'رواتب',         is_active: true },
    { key: 'marketing',   label: 'تسويق',        is_active: true },
    { key: 'utilities',   label: 'فواتير',       is_active: true },
    { key: 'supplies',    label: 'مستلزمات',     is_active: true },
    { key: 'maintenance', label: 'صيانة',        is_active: true },
    { key: 'software',    label: 'برامج / تقنية', is_active: true },
    { key: 'travel',      label: 'مواصلات',      is_active: true },
    { key: 'other',       label: 'أخرى',         is_active: true },
  ],
  general: {
    institute_name:    'معهد الدراسات النفسية',
    institute_name_en: 'Institute of Psychological Studies',
    website_url:       'https://mahadnafsy.com',
    support_email:     'info@mahadnafsy.com',
    support_phone:     '',
    default_currency:  'EGP',
    default_timezone:  'Africa/Cairo',
    vat_percent:       14,
    invoice_prefix:    'INV',
    session_duration_default: 60,
    working_days:      ['Sunday','Monday','Tuesday','Wednesday','Thursday'],
  },
  nationalities: [
    { key: 'EGYPTIAN',             label: 'مصري',                   is_active: true },
    { key: 'NON_EGYPTIAN_EGYPT',   label: 'غير مصري (مقيم بمصر)',   is_active: true },
    { key: 'SAUDI_RESIDENT',       label: 'مقيم بالسعودية',         is_active: true },
    { key: 'INTERNATIONAL',        label: 'دولي',                   is_active: true },
  ],
  staff_roles: [
    { key: 'ADMIN',           label: 'مدير',              is_active: true },
    { key: 'MANAGER',         label: 'مشرف',              is_active: true },
    { key: 'SALES',           label: 'مبيعات',            is_active: true },
    { key: 'CONSULTANT',      label: 'مستشار / معالج',    is_active: true },
    { key: 'INSTRUCTOR',      label: 'محاضر',             is_active: true },
    { key: 'TRAINER',         label: 'مدرب',              is_active: true },
    { key: 'SUPPORT',         label: 'دعم عملاء',         is_active: true },
    { key: 'COLLECTION',      label: 'تحصيل',             is_active: true },
    { key: 'ACCOUNTANT',      label: 'محاسب',             is_active: true },
    { key: 'RECEPTION_DAQQI', label: 'استقبال دقي',       is_active: true },
    { key: 'EXPERT',          label: 'خبير',              is_active: false },
    { key: 'OTHER',           label: 'أخرى',              is_active: true },
  ],
  cert_pricing: [
    { type: 'social_solidarity',  label: 'شهادة تضامن اجتماعي', price_egyptian: 500,  price_non_egyptian: 700,  price_saudi: 800,  price_international: 1000 },
    { type: 'ain_shams',          label: 'جامعة عين شمس',        price_egyptian: 800,  price_non_egyptian: 1000, price_saudi: 1200, price_international: 1500 },
    { type: 'experience_external',label: 'خبرة خارجي',           price_egyptian: 400,  price_non_egyptian: 600,  price_saudi: 700,  price_international: 900  },
    { type: 'practice_external',  label: 'مزاولة خارجي',         price_egyptian: 400,  price_non_egyptian: 600,  price_saudi: 700,  price_international: 900  },
    { type: 'national_council',   label: 'المجلس القومي',         price_egyptian: 600,  price_non_egyptian: 800,  price_saudi: 1000, price_international: 1200 },
    { type: 'american_board',     label: 'البورد الأمريكي',       price_egyptian: 1200, price_non_egyptian: 1500, price_saudi: 1800, price_international: 2000 },
    { type: 'institute',          label: 'شهادة معهد',            price_egyptian: 300,  price_non_egyptian: 450,  price_saudi: 500,  price_international: 700  },
  ],
  financial: {
    consultation_price:        400,
    installment_down_pct:       30,
    max_installment_months:     12,
    default_lead_sla_hours:     24,
    lead_auto_archive_days:     90,
    vat_percent:                14,
    invoice_prefix:          'INV',
    session_duration_default:   60,
  },
};

// GET /api/admin/sys-config — get all sections or specific section
router.get('/api/admin/sys-config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const section = req.query.section;
    if (section) {
      const saved = await getSysConfig(section);
      return res.json(saved ?? SYS_DEFAULTS[section] ?? null);
    }
    // Return all sections
    const keys = Object.keys(SYS_DEFAULTS);
    const vals = await Promise.all(keys.map(k => getSysConfig(k)));
    const result = {};
    keys.forEach((k, i) => { result[k] = vals[i] ?? SYS_DEFAULTS[k]; });
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/sys-config/:section — save a section
router.put('/api/admin/sys-config/:section', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { section } = req.params;
    if (!Object.keys(SYS_DEFAULTS).includes(section)) return res.status(400).json({ error: 'Unknown section: ' + section });
    await setSysConfig(section, req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/sys-config/:section/reset — reset section to defaults
router.post('/api/admin/sys-config/:section/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { section } = req.params;
    if (!SYS_DEFAULTS[section]) return res.status(400).json({ error: 'Unknown section' });
    await setSysConfig(section, SYS_DEFAULTS[section]);
    res.json({ ok: true, data: SYS_DEFAULTS[section] });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/sys-config/public — for client-side use (branches, currencies, etc.)
router.get('/api/admin/sys-config/public', async (_req, res) => {
  try {
    const sections = ['branches', 'currencies', 'countries', 'payment_methods', 'session_types', 'general'];
    const values = await Promise.all(sections.map(k => getSysConfig(k)));
    const result = {};
    sections.forEach((k, i) => { result[k] = values[i] ?? SYS_DEFAULTS[k]; });
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Staff Account Password Management ────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/staff — list all staff
router.get('/api/admin/staff', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, role, image, specialization, joined_at, is_active, notes, commission_rate, created_at
       FROM staff ORDER BY name ASC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/staff/:id/set-password — admin sets password for staff member
router.post('/api/admin/staff/:id/set-password', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    const hash = await bcrypt.hash(password, 10);

    // Check if staff already has a login in users table
    const [[staff]] = await pool.query('SELECT id, email FROM staff WHERE id=? LIMIT 1', [req.params.id]);
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    // Upsert into users table (staff use email as username)
    await pool.query(
      `INSERT INTO users (id, email, password, role, name) VALUES (UUID(),?,?,'staff',?)
       ON DUPLICATE KEY UPDATE password=VALUES(password)`,
      [staff.email, hash, staff.name || staff.email]
    );
    res.json({ ok: true, message: 'تم تعيين كلمة المرور بنجاح' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/staff/:id/toggle-active — enable/disable staff login
router.post('/api/admin/staff/:id/toggle-active', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const [[staff]] = await pool.query('SELECT id, is_active, email FROM staff WHERE id=? LIMIT 1', [req.params.id]);
    if (!staff) return res.status(404).json({ error: 'Not found' });
    const newActive = staff.is_active ? 0 : 1;
    await pool.query('UPDATE staff SET is_active=? WHERE id=?', [newActive, req.params.id]);
    // Also update users table
    await pool.query('UPDATE users SET is_active=? WHERE email=?', [newActive, staff.email]).catch(() => {});
    // When deactivating: un-assign all leads and subscribers so they go to the pool
    if (!newActive) {
      await pool.query(
        'UPDATE leads SET assigned_sales_id=NULL, assigned_sales_name=NULL WHERE assigned_sales_id=?',
        [staff.id]
      ).catch(() => {});
      await pool.query(
        'UPDATE subscribers SET assigned_sales_id=NULL, assigned_sales_name=NULL WHERE assigned_sales_id=?',
        [staff.id]
      ).catch(() => {});
      await pool.query(
        'UPDATE subscribers SET assigned_cs_id=NULL, assigned_cs_name=NULL WHERE assigned_cs_id=?',
        [staff.id]
      ).catch(() => {});
      logger.info(`[staff] deactivated ${staff.id} — leads and subscribers unassigned`);
    }
    res.json({ ok: true, is_active: !!newActive });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: IP Whitelist ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Ensure ip_whitelist table
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ip_whitelist (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ip VARCHAR(64) NOT NULL,
      label VARCHAR(255) DEFAULT NULL,
      added_by VARCHAR(36) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ip (ip)
    ) CHARACTER SET utf8mb4`);
  } catch (e) { logger.warn('[ip_whitelist table]', e.message); }
})();

router.get('/api/admin/ip-whitelist', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, ip, label, created_at FROM ip_whitelist ORDER BY created_at DESC');
    res.json({ whitelist: rows });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/ip-whitelist', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ip, label } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    // Basic validation: IPv4 or CIDR
    if (!/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(ip.trim())) {
      return res.status(400).json({ error: 'Invalid IP format' });
    }
    await pool.query(
      'INSERT INTO ip_whitelist (ip, label, added_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label)',
      [ip.trim(), label || null, req.user?.uid || null]
    );
    const [[row]] = await pool.query('SELECT id, ip, label, created_at FROM ip_whitelist WHERE ip=?', [ip.trim()]);
    res.json({ ok: true, entry: row });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/ip-whitelist/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM ip_whitelist WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Generic Key-Value Store (for frontend tabs persistence) ───────
// ═══════════════════════════════════════════════════════════════════════════
// Allowed keys (whitelist to prevent abuse)
const KV_ALLOWED_KEYS = ['tasks_board', 'support_tickets', 'sales_motiv_posts', 'automation_rules'];

// GET /api/admin/kv/:key
router.get('/api/admin/kv/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    if (!KV_ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown key' });
    const [[row]] = await pool.query("SELECT `value` FROM site_config WHERE `key`=? LIMIT 1", [`kv_${key}`]);
    const data = row?.value ? JSON.parse(row.value) : null;
    res.json({ ok: true, key, data });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/kv/:key
router.put('/api/admin/kv/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    if (!KV_ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown key' });
    const value = req.body;
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [`kv_${key}`, JSON.stringify(value)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
