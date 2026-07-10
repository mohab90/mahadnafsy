'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { mailer, htmlEmail, sendEmail } = require('../lib/email');
const { tryJson } = require('../lib/helpers');
const { postPaymentJournal } = require('../lib/finance');
const { sendWhatsApp } = require('../lib/whatsapp');
const { syncLeadDealValue } = require('./public-orders');
const { createNotification } = require('../lib/notification');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');

// ── Payment Proofs — client submits & admin reviews ───────────────────────────

// Client: submit a payment proof (instapay / bank transfer receipt)
router.post('/api/me/payment-proof', requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    // Resolve subscriber
    const [[sub]] = await pool.query(
      'SELECT id FROM subscribers WHERE firebase_uid = ? OR email = ? LIMIT 1',
      [uid, email || '']
    );
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    const { amount, currency, course_id, payment_method, proof_image, note } = req.body;

    // ── Input validation ──────────────────────────────────────────────────────
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) return res.status(400).json({ error: 'Amount required' });
    if (parsedAmount > 500000) return res.status(400).json({ error: 'Invalid amount' });
    const VALID_CURRENCIES = new Set(['EGP', 'SAR', 'USD']);
    const safeCurrency = VALID_CURRENCIES.has(currency) ? currency : 'EGP';
    // Validate proof_image: must be a base64 image (data:image/...) or null
    if (proof_image) {
      if (typeof proof_image !== 'string') return res.status(400).json({ error: 'Invalid proof image' });
      if (proof_image.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max 5MB base64)' });
      // Only allow image MIME types — reject SVG (XSS risk) and non-image data URIs
      if (proof_image.startsWith('data:') && !/^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(proof_image)) {
        return res.status(400).json({ error: 'Only JPEG, PNG, WebP or GIF images are allowed' });
      }
    }
    const safeNote = note ? String(note).slice(0, 500) : null;
    const id = `pp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await pool.query(
      `INSERT INTO payment_proofs (id, subscriber_id, course_id, amount, currency, payment_method, proof_image, note)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, sub.id, course_id || null, parsedAmount, safeCurrency,
       payment_method || 'instapay', proof_image || null, safeNote]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/me/progress — client saves their own lecture progress (no admin needed)
router.patch('/api/me/progress', requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const emailNorm = email?.toLowerCase().trim() || '';
    if (!emailNorm && !uid) return res.status(400).json({ error: 'No identity in token' });
    const { lectureId, pct } = req.body || {};
    if (!lectureId || pct === undefined) return res.status(400).json({ error: 'lectureId and pct required' });
    const progress = Math.min(100, Math.max(0, Number(pct) || 0));
    const [[sub]] = await pool.query(
      'SELECT id, crm_json FROM subscribers WHERE firebase_uid = ? OR LOWER(TRIM(email)) = ? LIMIT 1',
      [uid || '', emailNorm]
    );
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    const crm = tryJson(sub.crm_json, {});
    crm.lectureProgress = { ...(crm.lectureProgress || {}), [lectureId]: progress };
    await pool.query('UPDATE subscribers SET crm_json = ? WHERE id = ?', [JSON.stringify(crm), sub.id]);
    // ── Auto-complete: check if all lectures in this lecture's course are done ──
    let completionData = null;
    if (progress >= 90) {
      try {
        const [[lec]] = await pool.query('SELECT course_id FROM course_lectures WHERE id=? LIMIT 1', [lectureId]);
        if (lec?.course_id) {
          const courseId = lec.course_id;
          const [[alreadyDone]] = await pool.query('SELECT id FROM course_completions WHERE subscriber_id=? AND course_id=? LIMIT 1', [sub.id, courseId]);
          if (!alreadyDone) {
            const [allLecs] = await pool.query('SELECT id FROM course_lectures WHERE course_id=?', [courseId]);
            if (allLecs.length > 0) {
              const lp = crm.lectureProgress || {};
              const allWatched = allLecs.every(l => (lp[l.id] || 0) >= 90);
              if (allWatched) {
                const certCode = 'MHAD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
                await pool.query(
                  'INSERT IGNORE INTO course_completions (id, subscriber_id, course_id, certificate_code) VALUES (UUID(),?,?,?)',
                  [sub.id, courseId, certCode]
                );
                const [[course]] = await pool.query('SELECT title FROM courses WHERE id=? LIMIT 1', [courseId]);
                const subEmail = emailNorm;
                const [[subInfo]] = await pool.query('SELECT name FROM subscribers WHERE id=? LIMIT 1', [sub.id]);
                if (subEmail) {
                  sendEmail(subEmail, `🎓 مبروك! أتممت كورس "${course?.title || ''}"`,
                    htmlEmail('شهادة إتمام', `
                      <p>مبروك <strong>${subInfo?.name || ''}</strong>!</p>
                      <p>لقد أتممت بنجاح كورس <strong>${course?.title || ''}</strong>.</p>
                      <p>كود الشهادة الرقمية الخاص بك:</p>
                      <div class="otp-box">${certCode}</div>
                      <p>يمكنك التحقق من الشهادة على موقعنا باستخدام هذا الكود.</p>
                    `)
                  ).catch(() => {});
                }
                await createNotification('certificate', 'إتمام كورس', `${subInfo?.name || emailNorm} أتم كورس "${course?.title || ''}"`, { courseId, certCode });
                completionData = { completed: true, certCode };
              }
            }
          }
        }
      } catch (cerr) { logger.warn('[progress] completion check error:', cerr.message); }
    }
    res.json({ ok: true, ...(completionData || {}) });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Client: get own payment proofs
router.get('/api/me/payment-proofs', requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const [[sub]] = await pool.query(
      'SELECT id FROM subscribers WHERE firebase_uid = ? OR email = ? LIMIT 1',
      [uid, email || '']
    );
    if (!sub) return res.json([]);
    const [rows] = await pool.query(
      'SELECT id, amount, currency, course_id, payment_method, note, status, reviewer_note, submitted_at, reviewed_at FROM payment_proofs WHERE subscriber_id = ? ORDER BY submitted_at DESC LIMIT 100',
      [sub.id]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: list payment proofs (default: pending only)
router.get('/api/admin/payment-proofs', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const statusFilter = req.query.status; // 'PENDING' | 'APPROVED' | 'REJECTED' | undefined (all)
    let sql = `SELECT pp.*, s.name AS subscriber_name, s.phone AS subscriber_phone, s.email AS subscriber_email,
               c.title AS course_title
               FROM payment_proofs pp
               LEFT JOIN subscribers s ON s.id = pp.subscriber_id
               LEFT JOIN courses c ON c.id = pp.course_id
               WHERE 1`;
    const params = [];
    if (statusFilter) { sql += ' AND pp.status = ?'; params.push(statusFilter.toUpperCase()); }
    sql += ' ORDER BY pp.submitted_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: approve or reject a payment proof
router.patch('/api/admin/payment-proofs/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { action, reviewer_note } = req.body; // action: 'approve' | 'reject'
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });

    const [[proof]] = await conn.query(
      `SELECT id, subscriber_id, course_id, amount, currency, payment_method, proof_image, note,
              status, reviewer_id, reviewer_note, submitted_at, reviewed_at
       FROM payment_proofs WHERE id = ?`, [id]
    );
    if (!proof) return res.status(404).json({ error: 'Proof not found' });
    if (proof.status !== 'PENDING') return res.status(409).json({ error: 'Already reviewed' });

    const reviewed_at = new Date();
    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
    await conn.beginTransaction();
    await conn.query(
      `UPDATE payment_proofs SET status=?, reviewer_note=?, reviewed_at=? WHERE id=?`,
      [newStatus, reviewer_note || null, reviewed_at, id]
    );

    // If approved → insert into payments table (server is sole writer — frontend must NOT call saveSubscriberPayment)
    if (action === 'approve') {
      // Resolve reviewer's name for attribution
      let reviewerName = null;
      if (req.user?.uid) {
        const [[ru]] = await conn.query('SELECT name FROM staff WHERE LOWER(TRIM(email)) = ? LIMIT 1', [(req.user?.email||'').toLowerCase().trim()]).catch(() => [[null]]);
        reviewerName = ru?.name || req.user?.email?.split('@')[0] || null;
      }
      const payId = `pp-${proof.id}`;
      await conn.query(
        `INSERT IGNORE INTO payments (id, subscriber_id, course_id, amount, currency, payment_type, payment_method,
         is_installment, note, date, status, staff_name, created_at)
         VALUES (?,?,?,?,?,'COURSE',?,0,?,NOW(),'paid',?,NOW())`,
        [payId, proof.subscriber_id, proof.course_id || null, proof.amount, proof.currency || 'EGP',
         proof.payment_method || 'تحويل',
         `تم اعتماد الإيصال${reviewer_note ? ' — ' + reviewer_note : ''}${proof.note ? ' | ملاحظة العميل: ' + proof.note : ''}`,
         reviewerName]
      );
    }

    await conn.commit();

    // Auto-sync lead deal_value after payment approval
    if (action === 'approve' && proof.subscriber_id) {
      syncLeadDealValue(proof.subscriber_id).catch(() => {});
      // Ledger-first: post the cash/revenue journal for the approved payment.
      postPaymentJournal({ paymentId: `pp-${proof.id}`, amount: proof.amount, currency: proof.currency || 'EGP', payType: 'COURSE', actor: req.user?.email || 'system' });
    }

    // Send WhatsApp notification to subscriber (best-effort, after commit)
    try {
      const [[sub]] = await pool.query('SELECT name, phone, email FROM subscribers WHERE id = ?', [proof.subscriber_id]);
      // Lifecycle: email receipt on approval (whatsapp handled just below to avoid dup).
      if (action === 'approve' && sub?.email) {
        require('../lib/lifecycle').trigger('payment_received',
          { name: sub.name, email: sub.email, amount: proof.amount, currency: proof.currency || 'EGP', itemTitle: proof.course_title },
          { channels: ['email'] });
      }
      if (sub?.phone) {
        const statusAr = action === 'approve' ? 'تم اعتماد' : 'تم رفض';
        const msg = action === 'approve'
          ? `✅ مرحباً ${sub.name || ''}، ${statusAr} إيصال دفعتك بمبلغ ${proof.amount} ${proof.currency || 'EGP'}. شكراً لك! 🎓`
          : `❌ مرحباً ${sub.name || ''}، ${statusAr} إيصال دفعتك بمبلغ ${proof.amount} ${proof.currency || 'EGP'}.${reviewer_note ? '\nالسبب: ' + reviewer_note : ''} يرجى التواصل معنا للمساعدة.`;
        await sendWhatsApp(sub.phone, msg);
      }
    } catch (notifyErr) {
      logger.warn('[payment-proof] WhatsApp notify failed:', notifyErr.message);
    }

    res.json({ ok: true, status: newStatus });
  } catch (e) {
    await conn.rollback();
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// Admin: get single payment proof image (with auth check)
router.get('/api/admin/payment-proofs/:id/image', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT proof_image FROM payment_proofs WHERE id = ?', [req.params.id]);
    if (!row || !row.proof_image) return res.status(404).json({ error: 'No image' });
    res.json({ image: row.proof_image });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


module.exports = router;
