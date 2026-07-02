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

router.get('/api/me/is-staff', requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    if (ADMIN_UIDS.includes(uid) || ADMIN_EMAILS.includes(email||'')) {
      return res.json({ isStaff: true, isAdmin: true });
    }
    const [[row]] = await pool.query(
      'SELECT id, role FROM staff WHERE (firebase_uid = ? OR email = ?) AND is_active = 1 LIMIT 1',
      [uid, email||'']
    );
    res.json({ isStaff: !!row, isAdmin: false, staffId: row?.id, role: row?.role });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Register activity (logged-in user opts in for a course / confirms interest) ─
// Was incorrectly named /api/auth/register — renamed to avoid duplicate route conflict.
router.post('/api/me/register-interest', requireAuth, async (req, res) => {
  try {
    const { name, phone, source } = req.body;
    const { uid, email } = req.user;
    // Auto-create lead in DB
    const id = `reg-${uid}`;
    await pool.query(
      `INSERT IGNORE INTO leads (id, name, email, phone, source, status)
       VALUES (?,?,?,?,?,?)`,
      [id, name||email?.split('@')[0]||'مستخدم', email||'', phone||'', source||'تسجيل اهتمام', 'new']
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Health check ──────────────────────────────────────────────────────────────
router.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: e.message });
  }
});

// ── Atomic client-code counter (admin) ───────────────────────────────────────
router.post('/api/admin/client-code', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
    const next = rows[0]?.next_value ?? 10001;
    await conn.query('UPDATE client_code_counter SET next_value=? WHERE id=1', [next + 1]);
    await conn.commit();
    res.json({ ok: true, code: `C${next}` });
  } catch (e) {
    await conn.rollback();
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// ── Public registration (creates a lead + issues client code) ─────────────────
router.post('/api/registrations', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const item = req.body;
    const id = item.id || uuidv4();
    // Atomic client code issuance
    let code = `C${Date.now()}`;
    try {
      await conn.beginTransaction();
      const [cRows] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
      const next = cRows[0]?.next_value ?? 10001;
      await conn.query('UPDATE client_code_counter SET next_value=? WHERE id=1', [next + 1]);
      await conn.commit();
      code = `C${next}`;
    } catch { await conn.rollback(); }
    conn.release();
    // Insert lead
    const { id: _id, name, email, phone, source, status, notes, createdAt, created_at, ...crmData } = item;
    await pool.query(
      `INSERT INTO leads (id, client_code, name, email, phone, source, status, notes, crm_json)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE crm_json=VALUES(crm_json),
         client_code=COALESCE(client_code, VALUES(client_code))`,
      [id, code, name||'', email||null, phone||'', source||'تسجيل اهتمام',
       'new', notes||null, JSON.stringify({ ...crmData, clientCode: code })]
    );
    res.json({ ok: true, id, clientCode: code });
  } catch (e) {
    try { conn.release(); } catch { /* ignore */ }
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ── Lead Capture Widget (public, no auth) ────────────────────────────────────
// POST /api/leads-public
router.post('/api/leads-public', publicLimiter,
  validateBody({
    name:  v => isString(v, 120) || 'name is required (max 120 chars)',
    phone: v => isString(v, 30)  || 'phone is required (max 30 chars)',
  }),
  async (req, res) => {
  try {
    const { name, phone, notes, source } = req.body;
    const id = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // Assign sequential client code
    let code = null;
    const conn = await pool.getConnection();
    try { code = await getNextClientCode(conn); } catch (_) {} finally { conn.release(); }
    await pool.execute(
      `INSERT INTO leads (id, client_code, name, phone, notes, status, interest_level, source, lead_type, created_at, hidden)
       VALUES (?, ?, ?, ?, ?, 'new', 'medium', ?, 'general', NOW(), 0)`,
      [id, code, name.trim().slice(0, 120), phone.trim().slice(0, 30), (notes || '').trim().slice(0, 500), (source || 'chatbot').slice(0, 50)]
    );
    // Lifecycle: instant welcome to the new lead (whatsapp; email skipped if absent).
    require('../../lib/lifecycle').trigger('lead_created', { name: name.trim(), phone: phone.trim() });
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── CRM Settings (sources, auto-assign, gsheet) ──────────────────────────────
router.get('/api/admin/crm-settings', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'crm_settings'");
    res.json(rows[0]?.value ? JSON.parse(rows[0].value) : {});
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.put('/api/admin/crm-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES ('crm_settings', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


// ── Round-Robin Lead Distribution ────────────────────────────────────────────
// POST /api/admin/leads/distribute
// body: { mode: 'unassigned' | 'all' }  — 'unassigned' only touches leads with no rep yet
router.post('/api/admin/leads/distribute', requireAuth, requireAdmin, async (req, res) => {
  const { mode = 'unassigned' } = req.body || {};
  try {
    const whereClause = mode === 'all'
      ? `WHERE hidden=0 AND status NOT IN ('converted','lost')`
      : `WHERE hidden=0 AND assigned_sales_id IS NULL AND status NOT IN ('converted','lost')`;
    const [targets] = await pool.execute(
      `SELECT id FROM leads ${whereClause} ORDER BY created_at ASC`
    );
    // Get all sales reps (staff with sales role)
    const [reps] = await pool.execute(
      `SELECT id, name FROM staff WHERE role IN ('SALES','MANAGER') AND is_active=1 ORDER BY name ASC`
    );
    if (!reps.length) return res.json({ ok: false, assigned: 0, reason: 'No sales reps found' });
    if (!targets.length) return res.json({ ok: true, assigned: 0 });
    // Use persisted round-robin index
    const [rrRows] = await pool.query("SELECT `value` FROM site_config WHERE `key`='crm_rr_index'");
    let rrIdx = parseInt(rrRows[0]?.value || '0') || 0;
    let count = 0;
    for (let i = 0; i < targets.length; i++) {
      const rep = reps[rrIdx % reps.length];
      await pool.execute(
        `UPDATE leads SET assigned_sales_id=?, assigned_sales_name=? WHERE id=?`,
        [rep.id, rep.name, targets[i].id]
      );
      rrIdx++;
      count++;
    }
    // Persist updated RR index
    await pool.query(
      "INSERT INTO site_config (`key`,`value`) VALUES ('crm_rr_index',?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [String(rrIdx)]
    );
    res.json({ ok: true, assigned: count, reps: reps.length });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Abandoned Checkout Lead Capture ──────────────────────────────────────────
// POST /api/public/checkout-intent  (requires auth — user must be logged in)
// Called by Checkout.tsx on mount when a logged-in user lands on checkout.
// Creates/updates a CRM lead with source='checkout_intent' so sales can follow up.
router.post('/api/public/checkout-intent', requireAuth, publicLimiter, async (req, res) => {
  try {
    const { itemId, itemType, itemTitle } = req.body || {};
    const { uid, email } = req.user;
    if (!email) return res.json({ ok: false, reason: 'no_email' });

    // Skip if already a subscriber (no point creating an "abandoned" lead)
    const [[alreadySub]] = await pool.query(
      'SELECT id FROM subscribers WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [email.toLowerCase().trim()]
    );
    if (alreadySub) return res.json({ ok: true, skipped: true, reason: 'already_subscriber' });

    // Upsert lead — create if not exists, update source/note if exists
    const leadId = `checkout-${uid}`;
    const crmJson = JSON.stringify({ interestedCourseIds: itemId ? [itemId] : [], itemTitle, itemType });
    await pool.query(
      `INSERT INTO leads (id, name, email, source, status, hidden, crm_json, created_at)
       VALUES (?, ?, ?, 'checkout_intent', 'new', 0, ?, NOW())
       ON DUPLICATE KEY UPDATE
         source = IF(source = 'checkout_intent', source, source),
         crm_json = VALUES(crm_json)`,
      [leadId, email.split('@')[0], email.toLowerCase().trim(), crmJson]
    );

    // Also create a PENDING order so the booking appears in Accounts (orders) — the team can
    // confirm it (record payment → enroll) or delete it. Previously bookings were CRM-only.
    const { customerName, customerEmail, customerPhone, amount, currency } = req.body || {};
    const otype = String(itemType || 'course').toUpperCase();
    if (itemId && Number(amount) > 0 && ['COURSE', 'BUNDLE', 'CONSULTATION'].includes(otype)) {
      const orderId = `intent-${uid}-${itemId}`;
      await pool.query(
        `INSERT INTO orders (id, type, item_id, item_title, amount, currency, payment_method,
           customer_name, customer_email, customer_phone, status, course_id, bundle_id, notes, created_at)
         VALUES (?,?,?,?,?,?, 'OTHER', ?,?,?, 'PENDING', ?, ?, 'حجز من الموقع — بانتظار التأكيد', NOW())
         ON DUPLICATE KEY UPDATE amount=VALUES(amount), item_title=VALUES(item_title),
           customer_name=VALUES(customer_name), customer_phone=VALUES(customer_phone),
           status=IF(status='PAID', status, 'PENDING')`,
        [orderId, otype, itemId, itemTitle || '', Number(amount) || 0,
         (currency && ['EGP', 'SAR', 'USD'].includes(currency)) ? currency : 'EGP',
         customerName || email.split('@')[0], customerEmail || email.toLowerCase().trim(), customerPhone || '',
         otype === 'COURSE' ? itemId : null, otype === 'BUNDLE' ? itemId : null]
      );
    }

    // Consultations: also create a PENDING consultation row so the booking shows in
    // the Consultations tab immediately (was previously created only on the paymob
    // webhook → bookings never appeared). Idempotent per user+therapist+date.
    if (String(itemType || '').toLowerCase() === 'consultation') {
      const { therapistId, sessionDate, sessionType } = req.body || {};
      let therapistName = '';
      if (therapistId) { const [[th]] = await pool.query('SELECT name FROM therapists WHERE id=? LIMIT 1', [therapistId]).catch(() => [[null]]); therapistName = th?.name || ''; }
      const consultId = `consult-${uid}-${therapistId || 'express'}-${(sessionDate || '').slice(0, 10)}`;
      await pool.query(
        `INSERT INTO consultations
           (id, tenant_id, client_name, client_email, client_phone, therapist_id, therapist_name,
            session_type, session_date, status, amount, currency, created_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?,?, NOW())
         ON DUPLICATE KEY UPDATE client_name=VALUES(client_name), client_phone=VALUES(client_phone),
           amount=VALUES(amount), session_type=VALUES(session_type), session_date=VALUES(session_date)`,
        [consultId, req.tenantId || 'tenant-default', customerName || email.split('@')[0],
         customerEmail || email.toLowerCase().trim(), customerPhone || '', therapistId || null, therapistName,
         sessionType || 'individual', sessionDate || null, Number(amount) || 0,
         (currency && ['EGP', 'SAR', 'USD'].includes(currency)) ? currency : 'EGP']
      ).catch(e => logger.warn('[checkout-intent consult]', e.message));
    }
    res.json({ ok: true });
  } catch (e) {
    logger.warn('[checkout-intent]', e.message);
    res.json({ ok: false, reason: e.message }); // best-effort — don't fail the checkout page
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Admin Subscriber Lecture Progress ─────────────────────────────
// GET /api/admin/subscribers/:id/payments — fetch all payments for a single subscriber (authoritative)
router.get('/api/admin/subscribers/:id/payments', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const subId = req.params.id;
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title, cert_type, branch
       FROM payments WHERE subscriber_id = ? ORDER BY \`date\` ASC`,
      [subId]
    );
    const payments = payRows.map(p => {
      const d = p.date;
      const dateStr = d instanceof Date ? d.toISOString().slice(0,10) : String(d || '').slice(0,10);
      return {
        id: p.id,
        amount: Number(p.amount) || 0,
        currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(),
        paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null,
        isInstallment: !!p.is_installment,
        courseId: p.course_id || null,
        bundleId: p.bundle_id || null,
        note: p.note || null,
        at: dateStr,
        status: p.status || 'paid',
        staffId: p.staff_id || null,
        staffName: p.staff_name || null,
        fromAccountNumber: p.from_account || null,
        source: p.source || null,
        itemTitle: p.item_title || null,
        certType: p.cert_type || null,
        branch: p.branch || null,
      };
    });
    res.json(payments);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/subscribers/:id/progress — get all lecture progress for a subscriber
router.get('/api/admin/subscribers/:id/progress', requireAuth, requireAdmin, async (req, res) => {
  try {
    const subId = req.params.id;
    // Get from lecture_progress table
    const [lpRows] = await pool.query(
      `SELECT lp.*, cl.title AS lecture_title, cl.course_id, c.title AS course_title
       FROM lecture_progress lp
       LEFT JOIN course_lectures cl ON cl.id = lp.lecture_id
       LEFT JOIN courses c ON c.id = lp.course_id
       WHERE lp.subscriber_id = ?
       ORDER BY lp.updated_at DESC`,
      [subId]
    );
    // Also get from crm_json lectureProgress (fallback)
    const [[sub]] = await pool.query('SELECT crm_json FROM subscribers WHERE id=? LIMIT 1', [subId]);
    const crm = tryJson(sub?.crm_json, {});
    const crmProgress = crm.lectureProgress || {};
    // Get all enrolled courses (batch load lectures + courses in 2 queries)
    const enrolledIds = (crm.enrolledCourseIds || []).filter(id => !id.startsWith('bundle:'));
    const courseStats = [];
    if (enrolledIds.length > 0) {
      const ph = enrolledIds.map(() => '?').join(',');
      const [allLectures] = await pool.query(
        `SELECT id, title, course_id FROM course_lectures WHERE course_id IN (${ph}) ORDER BY course_id, sort_order`,
        enrolledIds
      );
      const [allCourses] = await pool.query(`SELECT id, title FROM courses WHERE id IN (${ph})`, enrolledIds);
      const lecturesByCourse = {};
      allLectures.forEach(l => { (lecturesByCourse[l.course_id] = lecturesByCourse[l.course_id] || []).push(l); });
      const courseMap = Object.fromEntries(allCourses.map(c => [c.id, c.title]));
      for (const courseId of enrolledIds) {
        const lectures = lecturesByCourse[courseId] || [];
        const total = lectures.length;
        const completed = lectures.filter(l => (crmProgress[l.id] || 0) >= 90).length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        courseStats.push({ courseId, courseTitle: courseMap[courseId] || courseId, total, completed, pct });
      }
    }
    res.json({ lpRows, crmProgress, courseStats });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ── Waitlist ─────────────────────────────────────────────────────────────────
module.exports = router;
