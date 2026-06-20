'use strict';
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { sendWhatsApp } = require('../lib/whatsapp');
const { tryJson } = require('../lib/helpers');
const { logLeadEvent } = require('../lib/crm');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { whatsappSendLimiter, publicLimiter } = require('../middleware/rateLimits');

// ── Promo Codes ───────────────────────────────────────────────────────────────
// POST /api/promo/validate — public endpoint: validate a promo code for checkout
router.post('/api/promo/validate', async (req, res) => {
  const { code, amount } = req.body || {};
  if (!code) return res.status(400).json({ error: 'الكود مطلوب' });
  try {
    const [[promo]] = await pool.query(
      `SELECT id, code, description, discount_type, discount_value, min_order_amount, max_uses, used_count, expires_at, active
       FROM promo_codes WHERE code=? AND active=1 AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR used_count < max_uses) LIMIT 1`,
      [String(code).toUpperCase().trim()]
    );
    if (!promo) return res.status(404).json({ error: 'الكود غير صالح أو منتهي الصلاحية' });
    if (promo.min_order_amount > 0 && (amount || 0) < promo.min_order_amount) {
      return res.status(400).json({ error: `الحد الأدنى للطلب ${promo.min_order_amount} ج.م` });
    }
    const orderAmount = Number(amount) || 0;
    const discount = promo.discount_type === 'percent'
      ? Math.round(orderAmount * promo.discount_value / 100)
      : Number(promo.discount_value);
    res.json({ ok: true, discount, discountType: promo.discount_type, discountValue: Number(promo.discount_value), description: promo.description || '' });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/promo-codes
router.get('/api/admin/promo-codes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, code, description, discount_type, discount_value, min_order_amount, max_uses,
       used_count, expires_at, active, created_by, created_at
       FROM promo_codes ORDER BY created_at DESC`);
    res.json(rows);
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/promo-codes
router.post('/api/admin/promo-codes', requireAuth, requireAdmin, async (req, res) => {
  const { code, description, discount_type, discount_value, min_order_amount, max_uses, expires_at } = req.body || {};
  if (!code || !discount_value) return res.status(400).json({ error: 'الكود والخصم مطلوبان' });
  const id = uuidv4();
  try {
    await pool.query(
      `INSERT INTO promo_codes (id, code, description, discount_type, discount_value, min_order_amount, max_uses, expires_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, String(code).toUpperCase().trim(), description || null, discount_type || 'percent',
       Number(discount_value), Number(min_order_amount || 0), max_uses ? Number(max_uses) : null,
       expires_at || null, req.user.email]
    );
    res.json({ ok: true, id });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'الكود مستخدم بالفعل' });
    console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/promo-codes/:id
router.patch('/api/admin/promo-codes/:id', requireAuth, requireAdmin, async (req, res) => {
  const { active, description, max_uses, expires_at } = req.body || {};
  try {
    const updates = []; const vals = [];
    if (active !== undefined) { updates.push('active=?'); vals.push(active ? 1 : 0); }
    if (description !== undefined) { updates.push('description=?'); vals.push(description); }
    if (max_uses !== undefined) { updates.push('max_uses=?'); vals.push(max_uses ? Number(max_uses) : null); }
    if (expires_at !== undefined) { updates.push('expires_at=?'); vals.push(expires_at || null); }
    if (!updates.length) return res.json({ ok: true });
    vals.push(req.params.id);
    await pool.query(`UPDATE promo_codes SET ${updates.join(',')} WHERE id=?`, vals);
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/promo-codes/:id
router.delete('/api/admin/promo-codes/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM promo_codes WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


// ── CRM Advanced ─────────────────────────────────────────────────────────────

// GET /api/admin/crm/stale-leads?days=7
// Leads not contacted in N days OR with overdue next_follow_up_date
router.get('/api/admin/crm/stale-leads', requireAuth, requireAdminOrStaff, async (req, res) => {
  const days = Math.min(parseInt(req.query.days || '7'), 90);
  try {
    let sql = `
      SELECT
        l.id, l.name, l.email, l.phone, l.status, l.interest_level,
        l.next_follow_up_date, l.last_follow_up,
        l.assigned_sales_name, l.assigned_cs_name,
        COALESCE(MAX(c.date), l.last_follow_up, l.created_at) AS last_comm_date,
        DATEDIFF(NOW(), COALESCE(MAX(c.date), l.last_follow_up, l.created_at)) AS days_silent
      FROM leads l
      LEFT JOIN communications c ON c.lead_id = l.id
      WHERE l.hidden = 0 AND LOWER(l.status) NOT IN ('converted','lost','not_interested')`;
    const params = [];
    const staffRole = (req.staffRecord?.role || '').toUpperCase();
    if (req.staffRecord && !req.isSuperAdmin) {
      if (staffRole === 'SALES') {
        sql += ' AND l.assigned_sales_id = ?';
        params.push(req.staffRecord.id);
      } else if (staffRole === 'COLLECTION' || staffRole === 'CS') {
        sql += ' AND l.id IN (SELECT lead_id FROM subscribers WHERE assigned_cs_id = ? AND lead_id IS NOT NULL)';
        params.push(req.staffRecord.id);
      }
    }
    sql += `
      GROUP BY l.id
      HAVING
        (l.next_follow_up_date IS NOT NULL AND l.next_follow_up_date < NOW())
        OR days_silent >= ?
      ORDER BY days_silent DESC
      LIMIT 200`;
    params.push(days);
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/crm/follow-up-due
// Leads with next_follow_up_date today or overdue
router.get('/api/admin/crm/follow-up-due', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    let sql = `
      SELECT
        l.id, l.name, l.email, l.phone, l.status, l.interest_level,
        l.next_follow_up_date, l.assigned_sales_name, l.assigned_cs_name,
        DATEDIFF(NOW(), l.next_follow_up_date) AS overdue_days
      FROM leads l
      WHERE l.hidden = 0
        AND l.next_follow_up_date IS NOT NULL
        AND l.next_follow_up_date <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        AND LOWER(l.status) NOT IN ('converted','lost')`;
    const params = [];
    const fuRole = (req.staffRecord?.role || '').toUpperCase();
    if (req.staffRecord && !req.isSuperAdmin) {
      if (fuRole === 'SALES') {
        sql += ' AND l.assigned_sales_id = ?';
        params.push(req.staffRecord.id);
      } else if (fuRole === 'COLLECTION' || fuRole === 'CS') {
        sql += ' AND l.id IN (SELECT lead_id FROM subscribers WHERE assigned_cs_id = ? AND lead_id IS NOT NULL)';
        params.push(req.staffRecord.id);
      }
    }
    sql += ' ORDER BY l.next_follow_up_date ASC LIMIT 100';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/crm/bulk-whatsapp
// Body: { leads: [{id, phone, name}], message: "..." }   (use {name} placeholder)
// Sends WA to each lead, logs communication entry, updates last_follow_up
router.post('/api/admin/crm/bulk-whatsapp', requireAuth, requireAdminOrStaff, requirePermission('bulk_whatsapp'), whatsappSendLimiter, async (req, res) => {
  const { leads = [], message } = req.body || {};
  if (!message || !leads.length) return res.status(400).json({ error: 'leads[] and message required' });
  if (leads.length > 100) return res.status(400).json({ error: 'max 100 leads per batch' });
  // SALES staff can only bulk-WA their own assigned leads
  const salesFilter = req.staffRecord?.role === 'SALES' ? req.staffRecord.id : null;
  const results = [];
  for (const lead of leads) {
    // SALES staff can only send WA to their own assigned leads
    if (salesFilter) {
      const [[chk]] = await pool.query('SELECT assigned_sales_id FROM leads WHERE id = ? LIMIT 1', [lead.id]).catch(() => [[null]]);
      if (chk?.assigned_sales_id !== salesFilter) { results.push({ id: lead.id, ok: false, err: 'غير مصرح' }); continue; }
    }
    const phone       = (lead.phone || '').replace(/\D/g, '');
    const personalMsg = message.replace(/\{name\}/g, lead.name || '');
    let ok = false; let errMsg = null;
    try {
      await sendWhatsApp(phone, personalMsg);
      ok = true;
      await pool.query(
        `INSERT INTO communications (id, lead_id, type, date, notes, staff_id)
         VALUES (?, ?, 'WHATSAPP', NOW(), ?, ?)`,
        [uuidv4(), lead.id, `رسالة جماعية: ${personalMsg.substring(0, 100)}`, req.user?.uid || null]
      );
      await pool.query('UPDATE leads SET last_follow_up = NOW() WHERE id = ?', [lead.id]);
      await logLeadEvent(lead.id, 'WHATSAPP_SENT', `رسالة جماعية للرقم ${phone}`,
        { msg: personalMsg.substring(0, 200), sender: req.user?.email });
    } catch (e) { errMsg = e.message; }
    results.push({ id: lead.id, phone, ok, err: errMsg });
  }
  const sent = results.filter(r => r.ok).length;
  res.json({ ok: true, sent, failed: results.length - sent, results });
});

// ── Payments Advanced ─────────────────────────────────────────────────────────

// GET /api/admin/payments/outstanding
// Subscribers where sum(course_expected) > sum(amount paid) — i.e. outstanding balance > 0
router.get('/api/admin/payments/outstanding', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        s.id, s.name, s.email, s.phone, s.client_code,
        s.assigned_sales_name, s.assigned_cs_name,
        COALESCE(SUM(CASE WHEN p.is_installment = 0 THEN p.course_expected ELSE 0 END), 0) AS total_expected,
        COALESCE(SUM(CASE WHEN p.is_installment = 0 THEN p.amount ELSE 0 END),          0) AS total_paid,
        COALESCE(SUM(CASE WHEN p.is_installment = 0 THEN p.course_expected ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN p.is_installment = 0 THEN p.amount ELSE 0 END), 0)     AS outstanding
      FROM subscribers s
      JOIN payments p ON p.subscriber_id = s.id
      WHERE s.is_active = 1 AND p.course_expected IS NOT NULL AND p.course_expected > 0
        AND p.is_installment = 0
      GROUP BY s.id
      HAVING outstanding > 0
      ORDER BY outstanding DESC
      LIMIT 300
    `);
    const total = rows.reduce((s, r) => s + (parseFloat(r.outstanding) || 0), 0);
    res.json({ subscribers: rows, total_outstanding: total, count: rows.length });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/payments/send-reminder
// Body: { subscriberIds?: string[], all?: boolean, message?: string }
// Sends WA payment reminder to outstanding subscribers
router.post('/api/admin/payments/send-reminder', requireAuth, requireAdmin, async (req, res) => {
  const { subscriberIds, all, message } = req.body || {};
  let subs = [];
  try {
    const baseQuery = `
      SELECT s.id, s.name, s.phone,
             COALESCE(SUM(p.course_expected),0) - COALESCE(SUM(p.amount),0) AS outstanding
      FROM subscribers s
      JOIN payments p ON p.subscriber_id = s.id
      WHERE p.course_expected IS NOT NULL AND p.course_expected > 0 AND p.is_installment = 0
    `;
    if (all) {
      const [rows] = await pool.query(baseQuery + ' GROUP BY s.id HAVING outstanding > 0 LIMIT 200');
      subs = rows;
    } else if (Array.isArray(subscriberIds) && subscriberIds.length) {
      const [rows] = await pool.query(
        baseQuery + ' AND s.id IN (?) GROUP BY s.id HAVING outstanding > 0',
        [subscriberIds]
      );
      subs = rows;
    }
    if (!subs.length) return res.json({ ok: true, sent: 0, message: 'لا يوجد مشتركين برصيد مستحق' });
    const results = [];
    for (const sub of subs) {
      const phone   = (sub.phone || '').replace(/\D/g, '');
      const amount  = parseFloat(sub.outstanding) || 0;
      const msg = message
        ? message.replace(/\{name\}/g, sub.name || '').replace(/\{amount\}/g, amount.toFixed(0))
        : `أهلاً ${sub.name || ''} 💚\nنود تذكيرك بأن لديك رصيداً مستحقاً بمبلغ ${amount.toFixed(0)} ج.م.\nيرجى التواصل معنا لتسوية الرصيد.\nشكراً لثقتك بمعهد مهاد 🌿`;
      let ok = false;
      try { await sendWhatsApp(phone, msg); ok = true; } catch (_) {}
      results.push({ id: sub.id, phone, ok });
    }
    const sent = results.filter(r => r.ok).length;
    res.json({ ok: true, sent, failed: results.length - sent, results });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/payments/bulk-stub
// Body: { dryRun?: boolean }
// Creates zero-amount historical stub records for enrollments without payment entries.
// dryRun=true (default) only returns count — set dryRun=false to actually insert.
router.post('/api/admin/payments/bulk-stub', requireAuth, requireAdmin, async (req, res) => {
  const { dryRun = true } = req.body || {};
  try {
    const [rows] = await pool.query(`
      SELECT e.id AS enroll_id, e.subscriber_id, e.course_id, e.bundle_id, e.enrolled_at,
             s.name, s.email
      FROM enrollments e
      JOIN subscribers s ON s.id = e.subscriber_id
      LEFT JOIN payments p ON p.subscriber_id = e.subscriber_id
        AND (p.course_id = e.course_id OR (e.course_id IS NULL AND p.bundle_id = e.bundle_id))
      WHERE p.id IS NULL
      LIMIT 1000
    `);
    if (dryRun) return res.json({ dryRun: true, count: rows.length, sample: rows.slice(0, 5) });
    let created = 0;
    for (const r of rows) {
      await pool.query(
        `INSERT IGNORE INTO payments (id, subscriber_id, course_id, bundle_id, amount, currency,
           payment_type, payment_method, date, note)
         VALUES (?, ?, ?, ?, 0, 'EGP', 'OTHER', 'manual', ?, 'تسجيل تاريخي — تسوية تلقائية')`,
        [uuidv4(), r.subscriber_id, r.course_id || null, r.bundle_id || null, r.enrolled_at]
      );
      created++;
    }
    await pool.query(
      'INSERT INTO activity_logs (id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?)',
      [uuidv4(), 'bulk_stub', 'payments', null,
       `إنشاء ${created} سجل دفع تاريخي بالصفر`, req.user?.email || 'admin']
    );
    res.json({ ok: true, created });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
