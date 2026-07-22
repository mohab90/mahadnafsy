'use strict';
const logger = require('../../lib/logger');
const bcrypt   = require('bcryptjs');
const { uuidv4 } = require('../../lib/id');
const { pool } = require('../../lib/db');
const { mailer, sendEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const express = require('express');
const router = express.Router();
const { logLogin, sendDailyReport, scheduleDailyReport, pushAdminNotif, runFollowUpReminders, scheduleFollowUpReminders, runPaymentDueReminders, schedulePaymentReminders, getSysConfig, setSysConfig, SYS_DEFAULTS, KV_ALLOWED_KEYS } = require('./_shared');

router.get('/api/admin/leads/due-today', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [leads] = await pool.query(`
      SELECT l.id, l.name, l.phone, l.email, l.status, l.source,
             l.next_follow_up_date, l.assigned_sales_id AS assigned_to,
             st.name AS staff_name
      FROM leads l
      LEFT JOIN staff st ON st.id = l.assigned_sales_id AND st.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND DATE(l.next_follow_up_date) = ?
        AND l.status NOT IN ('converted','disqualified','archived')
        ${req.staffRecord?.role === 'SALES' ? 'AND l.assigned_sales_id = ?' : ''}
      ORDER BY l.name`, [req.tenantId, today, ...(req.staffRecord?.role === 'SALES' ? [req.staffRecord.id] : [])]);
    res.json({ date: today, count: leads.length, leads });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/leads/reminders/send-now — manually trigger follow-up reminders
router.post('/api/admin/leads/reminders/send-now', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  try {
    await runFollowUpReminders(req.tenantId);
    res.json({ ok: true, message: 'تم إرسال تذكيرات المتابعة' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Payment Due Reminders (Subscribers) ──────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


router.get('/api/admin/payments/due-upcoming', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days || '7', 10) || 7));
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const [rows] = await pool.query(`
      SELECT p.id, p.amount, p.currency, p.date AS due_date,
             DATEDIFF(p.date, CURDATE()) AS days_left,
             s.id AS subscriber_id, s.name, s.phone, s.client_code, s.branch
      FROM payments p
      JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND p.status = 'pending'
        AND DATE(p.date) BETWEEN ? AND ?
      ORDER BY p.date ASC
      LIMIT 200`, [req.tenantId, today, future]);
    res.json({ from: today, to: future, count: rows.length, payments: rows });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/payments/reminders/send-now — manually trigger payment reminders
router.post('/api/admin/payments/reminders/send-now', requireAuth, requireAdmin, requirePermission('view_financial'), async (req, res) => {
  try {
    await runPaymentDueReminders(req.tenantId);
    res.json({ ok: true, message: 'تم إرسال تذكيرات الدفع' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Revenue Source Breakdown ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/analytics/revenue-sources?from=&to=
router.get('/api/admin/analytics/revenue-sources', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.from || new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    const to   = req.query.to   || now.toISOString().slice(0, 10);

    // By payment_type
    const [byType] = await pool.query(`
      SELECT COALESCE(payment_type, 'other') AS source,
             COUNT(*) AS transactions, SUM(amount_egp) AS total
      FROM payments WHERE tenant_id=? AND status='paid' AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY source ORDER BY total DESC`, [req.tenantId, from, to]);

    // Monthly breakdown by source
    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(created_at,'%Y-%m') AS month,
             COALESCE(payment_type, 'other') AS source,
             SUM(amount_egp) AS total
      FROM payments WHERE tenant_id=? AND status='paid' AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY month, source ORDER BY month, total DESC`, [req.tenantId, from, to]);

    // Top paying clients
    const [topClients] = await pool.query(`
      SELECT s.id, s.name, s.phone, s.branch, s.client_code,
             SUM(p.amount_egp) AS total_paid, COUNT(p.id) AS payment_count
      FROM payments p JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
      WHERE p.tenant_id=? AND p.status='paid' AND DATE(p.created_at) BETWEEN ? AND ?
      GROUP BY s.id ORDER BY total_paid DESC LIMIT 20`, [req.tenantId, from, to]);

    // By branch
    const [byBranch] = await pool.query(`
      SELECT COALESCE(s.branch,'غير محدد') AS branch,
             SUM(p.amount_egp) AS total, COUNT(p.id) AS count
      FROM payments p JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
      WHERE p.tenant_id=? AND p.status='paid' AND DATE(p.created_at) BETWEEN ? AND ?
      GROUP BY branch ORDER BY total DESC`, [req.tenantId, from, to]);

    const [[{ grand_total }]] = await pool.query(
      `SELECT COALESCE(SUM(amount_egp),0) AS grand_total FROM payments WHERE tenant_id=? AND status='paid' AND DATE(created_at) BETWEEN ? AND ?`,
      [req.tenantId, from, to]
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
      `SELECT COUNT(*) AS followup_due FROM leads WHERE tenant_id=? AND DATE(next_follow_up_date) = ? AND status NOT IN ('converted','disqualified','archived')`, [req.tenantId, today]);
    const [[{ followup_overdue }]] = await pool.query(
      `SELECT COUNT(*) AS followup_overdue FROM leads WHERE tenant_id=? AND next_follow_up_date < ? AND status NOT IN ('converted','disqualified','archived')`, [req.tenantId, today]);
    const [[{ payment_due_3d }]] = await pool.query(
      `SELECT COUNT(*) AS payment_due_3d FROM payments WHERE tenant_id=? AND status='pending' AND is_installment=1 AND DATE(date) BETWEEN ? AND DATE_ADD(?, INTERVAL 3 DAY)`, [req.tenantId, today, today]);
    const [[{ payment_overdue }]] = await pool.query(
      `SELECT COUNT(*) AS payment_overdue FROM payments WHERE tenant_id=? AND status='pending' AND is_installment=1 AND DATE(date) < ?`, [req.tenantId, today]);
    const [[{ reminders_sent_today }]] = await pool.query(
      `SELECT COUNT(*) AS reminders_sent_today FROM reminder_log WHERE tenant_id=? AND DATE(sent_at) = ?`, [req.tenantId, today]).catch(() => [[{ reminders_sent_today: 0 }]]);
    const [[{ drip_active }]] = await pool.query(
      `SELECT COUNT(*) AS drip_active FROM drip_campaigns WHERE tenant_id=? AND is_active=1`, [req.tenantId]).catch(() => [[{ drip_active: 0 }]]);
    const [[{ workflows_active }]] = await pool.query(
      `SELECT COUNT(*) AS workflows_active FROM automation_workflows WHERE tenant_id=? AND enabled=1`, [req.tenantId]).catch(() => [[{ workflows_active: 0 }]]);

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
          </div>`,
          { tenantId: req.tenantId }
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
module.exports = router;
