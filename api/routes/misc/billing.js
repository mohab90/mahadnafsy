'use strict';
const logger = require('../../lib/logger');
const bcrypt   = require('bcryptjs');
const { uuidv4 } = require('../../lib/id');
const { pool } = require('../../lib/db');
const { mailer, sendEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { getTenantSetting } = require('../../lib/tenantSettings');
const express = require('express');
const router = express.Router();
const { logLogin, sendDailyReport, scheduleDailyReport, pushAdminNotif, runFollowUpReminders, scheduleFollowUpReminders, runPaymentDueReminders, schedulePaymentReminders, getSysConfig, setSysConfig, SYS_DEFAULTS, KV_ALLOWED_KEYS } = require('./_shared');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

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
      const billingPayRows = due.map(() => `(UUID(), ?, ?, 'subscription', 'pending', ?, NOW())`);
      const billingPayParams = due.flatMap(sub => [sub.subscriber_id, sub.price, `Auto-billing plan: ${sub.plan_id}`]);
      let billingInsertOk = false;
      try {
        await pool.query(
          `INSERT INTO payments (id, subscriber_id, amount, payment_method, status, note, created_at) VALUES ${billingPayRows.join(',')}`,
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
}, requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const [[payment]] = await pool.query(
      `SELECT p.*, s.name AS client_name, s.phone AS client_phone, s.email AS client_email,
              s.client_code, s.branch
       FROM payments p
       LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
       WHERE p.id = ? AND p.tenant_id = ?`, [req.params.id, req.tenantId]);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const settings = await getTenantSetting('sys_general', { tenantId: req.tenantId, fallback: {} });
    const siteName = escapeHtml(settings.site_name || settings.siteName || 'المعهد النفسي');
    const sitePhone = escapeHtml(settings.phone || '');
    const siteEmail = escapeHtml(settings.email || '');
    const invoiceId = escapeHtml(payment.id);
    const clientName = escapeHtml(payment.client_name || 'عميل');
    const clientCode = escapeHtml(payment.client_code || '-');
    const clientPhone = escapeHtml(payment.client_phone || '');
    const clientEmail = escapeHtml(payment.client_email || '');
    const description = escapeHtml(payment.notes || payment.note || 'خدمات تعليمية');
    const method = escapeHtml(payment.method || payment.payment_method || '-');
    const status = escapeHtml(payment.status || 'pending');

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>فاتورة #${invoiceId}</title>
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
        <p>رقم الفاتورة: #${invoiceId}</p>
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
        <p>${clientName}</p>
        <span>كود: ${clientCode}</span>
        <span>${clientPhone}</span>
        <span>${clientEmail}</span>
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
          <td>${description}</td>
          <td>${method}</td>
          <td>
            <span class="status-badge ${payment.status === 'paid' ? 'status-paid' : 'status-pending'}">
              ${payment.status === 'paid' ? 'مدفوع' : payment.status === 'pending' ? 'معلق' : status}
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
module.exports = router;
