'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { mailer, htmlEmail, sendEmail } = require('../lib/email');
const { tryJson } = require('../lib/helpers');
const { ensureSubscriberForOrder } = require('../lib/subscriberProvisioning');
const { postPaymentJournal } = require('../lib/finance');
const { assertWritable } = require('../lib/periodLock');
const { sendWhatsApp } = require('../lib/whatsapp');
const { enqueueFinanceEvent } = require('../lib/financeOutbox');
const { createNotification } = require('../lib/notification');
const { transitionLead } = require('../lib/leadState');
const { publishRealtimeEvent } = require('../lib/realtime');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');

function tenantIdFor(req) {
  return req.tenantId || req.user?.tenant_id || 'tenant-default';
}

function branchForId(branchId) {
  const map = {
    'branch-daqqi': 'DAQQI',
    'branch-tagamoa': 'TAGAMOA',
    'branch-online-saudi': 'ONLINE_SAUDI',
    'branch-online-abroad': 'ONLINE_ABROAD',
    'branch-online-egypt': 'ONLINE_EGYPT',
  };
  return map[branchId] || 'ONLINE_EGYPT';
}

// ── Payment Proofs — client submits & admin reviews ───────────────────────────

// Client: submit a payment proof (instapay / bank transfer receipt)
router.post('/api/me/payment-proof', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { uid, email } = req.user;
    const tenantId = tenantIdFor(req);
    const normalizedEmail = String(email || '').toLowerCase().trim();
    const { order_id, payment_method, proof_image, note } = req.body || {};
    if (!order_id || !normalizedEmail) return res.status(400).json({ error: 'order_id and authenticated email required' });
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
    await conn.beginTransaction();
    transactionStarted = true;
    const [[order]] = await conn.query(
      `SELECT id, type, item_id, item_title, amount, currency, customer_name, customer_email,
              customer_phone, status, subscriber_id, course_id, bundle_id, tenant_id, branch_id
         FROM orders
        WHERE id=? AND tenant_id=? AND LOWER(TRIM(customer_email))=? LIMIT 1 FOR UPDATE`,
      [order_id, tenantId, normalizedEmail]
    );
    if (!order) { await conn.rollback(); transactionStarted = false; return res.status(404).json({ error: 'Order not found' }); }
    if (order.status !== 'pending') { await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'Order is not pending payment' }); }
    if (Number(order.amount) <= 0 || Number(order.amount) > 500000) {
      await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'Order amount is invalid' });
    }
    const [[existingProof]] = await conn.query(
      "SELECT id FROM payment_proofs WHERE order_id=? AND status IN ('PENDING','APPROVED') LIMIT 1 FOR UPDATE",
      [order.id]
    );
    if (existingProof) { await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'A payment proof already exists for this order' }); }

    const sub = await ensureSubscriberForOrder(conn, {
      tenantId, uid, email: normalizedEmail, name: order.customer_name, phone: order.customer_phone,
      fallbackBranch: branchForId(order.branch_id),
      fallbackBranchId: order.branch_id,
    });
    await conn.query('UPDATE orders SET subscriber_id=? WHERE id=? AND tenant_id=?', [sub.id, order.id, tenantId]);

    const id = `pp-${uuidv4()}`;
    await conn.query(
      `INSERT INTO payment_proofs
         (id, order_id, subscriber_id, course_id, bundle_id, item_type, amount, currency,
          payment_method, proof_image, note, tenant_id, branch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, order.id, sub.id, order.course_id || null, order.bundle_id || null,
       String(order.type || 'OTHER').toLowerCase(), order.amount, order.currency || 'EGP',
       String(payment_method || 'instapay').slice(0, 50), proof_image || null, safeNote,
       tenantId, order.branch_id || sub.branch_id || 'branch-other']
    );
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, id });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// PATCH /api/me/progress — client saves their own lecture progress (no admin needed)
router.patch('/api/me/progress', requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const tenantId = tenantIdFor(req);
    const emailNorm = email?.toLowerCase().trim() || '';
    if (!emailNorm && !uid) return res.status(400).json({ error: 'No identity in token' });
    const { lectureId, pct } = req.body || {};
    if (!lectureId || pct === undefined) return res.status(400).json({ error: 'lectureId and pct required' });
    const progress = Math.min(100, Math.max(0, Number(pct) || 0));
    const [[sub]] = await pool.query(
      'SELECT id, crm_json FROM subscribers WHERE tenant_id=? AND (firebase_uid = ? OR LOWER(TRIM(email)) = ?) LIMIT 1',
      [tenantId, uid || '', emailNorm]
    );
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    const [[entitledLecture]] = await pool.query(
      `SELECT cl.id, cl.course_id
       FROM course_lectures cl
       JOIN courses c ON c.id=cl.course_id AND c.tenant_id=?
       JOIN enrollments e ON e.course_id=cl.course_id AND e.subscriber_id=? AND e.tenant_id=?
       WHERE cl.id=? AND (
         COALESCE(c.price_egp,c.price,0)<=0 OR
         COALESCE((SELECT SUM(p.amount_egp) FROM payments p
                   WHERE p.subscriber_id=? AND p.course_id=c.id AND p.tenant_id=?
                     AND p.status IN ('paid','confirmed') AND p.deleted_at IS NULL),0) >= COALESCE(c.price_egp,c.price,0)
         OR EXISTS (
           SELECT 1 FROM payments bp
           JOIN bundle_courses bc ON bc.bundle_id=bp.bundle_id AND bc.course_id=c.id
           WHERE bp.subscriber_id=? AND bp.tenant_id=?
             AND bp.status IN ('paid','confirmed') AND bp.deleted_at IS NULL
         )
       ) LIMIT 1`,
      [tenantId, sub.id, tenantId, lectureId, sub.id, tenantId, sub.id, tenantId]
    );
    if (!entitledLecture) return res.status(403).json({ error: 'Active paid enrollment is required' });
    const crm = tryJson(sub.crm_json, {});
    crm.lectureProgress = { ...(crm.lectureProgress || {}), [lectureId]: progress };
    await pool.query(
      `INSERT INTO lecture_completions
         (id, subscriber_id, lecture_id, course_id, progress_pct, watch_seconds, completed_at, tenant_id)
       VALUES (UUID(),?,?,?,?,0,IF(?=100,NOW(),NULL),?)
       ON DUPLICATE KEY UPDATE progress_pct=GREATEST(progress_pct,VALUES(progress_pct)),
         completed_at=IF(GREATEST(progress_pct,VALUES(progress_pct))=100,COALESCE(completed_at,NOW()),completed_at),
         tenant_id=VALUES(tenant_id)`,
      [sub.id, lectureId, entitledLecture.course_id, progress, progress, tenantId]
    );
    await pool.query('UPDATE subscribers SET crm_json = ? WHERE id = ? AND tenant_id=?', [JSON.stringify(crm), sub.id, tenantId]);
    // ── Auto-complete: check if all lectures in this lecture's course are done ──
    let completionData = null;
    if (progress >= 100) {
      try {
        const [[lec]] = await pool.query(
          `SELECT cl.course_id
             FROM course_lectures cl
             JOIN enrollments e ON e.course_id=cl.course_id AND e.subscriber_id=? AND e.tenant_id=?
            WHERE cl.id=? AND EXISTS (
              SELECT 1 FROM payments p
               WHERE p.subscriber_id=e.subscriber_id AND p.tenant_id=e.tenant_id
                 AND p.status='paid' AND p.deleted_at IS NULL
                 AND (p.course_id=e.course_id OR EXISTS (
                   SELECT 1 FROM bundle_courses bc WHERE bc.bundle_id=p.bundle_id AND bc.course_id=e.course_id
                 ))
            ) LIMIT 1`,
          [sub.id, tenantId, lectureId]
        );
        if (lec?.course_id) {
          const courseId = lec.course_id;
          const [[alreadyDone]] = await pool.query('SELECT id FROM course_completions WHERE subscriber_id=? AND course_id=? AND tenant_id=? LIMIT 1', [sub.id, courseId, tenantId]);
          if (!alreadyDone) {
            const [allLecs] = await pool.query(
              `SELECT cl.id FROM course_lectures cl JOIN courses c ON c.id=cl.course_id
               WHERE cl.course_id=? AND cl.is_published=1 AND c.tenant_id=?`,
              [courseId, tenantId]
            );
            if (allLecs.length > 0) {
              const lp = crm.lectureProgress || {};
              const allWatched = allLecs.every(l => (lp[l.id] || 0) >= 100);
              if (allWatched) {
                const certCode = 'MHAD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
                await pool.query(
                  'INSERT IGNORE INTO course_completions (id, subscriber_id, course_id, certificate_code, tenant_id) VALUES (UUID(),?,?,?,?)',
                  [sub.id, courseId, certCode, tenantId]
                );
                const [[course]] = await pool.query('SELECT title FROM courses WHERE id=? AND tenant_id=? LIMIT 1', [courseId, tenantId]);
                const subEmail = emailNorm;
                const [[subInfo]] = await pool.query('SELECT name FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [sub.id, tenantId]);
                if (subEmail) {
                  sendEmail(subEmail, `🎓 مبروك! أتممت كورس "${course?.title || ''}"`,
                    htmlEmail('شهادة إتمام', `
                      <p>مبروك <strong>${subInfo?.name || ''}</strong>!</p>
                      <p>لقد أتممت بنجاح كورس <strong>${course?.title || ''}</strong>.</p>
                      <p>كود الشهادة الرقمية الخاص بك:</p>
                      <div class="otp-box">${certCode}</div>
                      <p>يمكنك التحقق من الشهادة على موقعنا باستخدام هذا الكود.</p>
                    `),
                    { tenantId }
                  ).catch(() => {});
                }
                await createNotification('certificate', 'إتمام كورس', `${subInfo?.name || emailNorm} أتم كورس "${course?.title || ''}"`, { courseId, certCode }, req.tenantId);
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

router.get('/api/admin/subscribers/:id/progress', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const tenantId = tenantIdFor(req);
    const [[subscriber]] = await pool.query(
      'SELECT id, crm_json FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
      [req.params.id, tenantId]
    );
    if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });
    const crm = tryJson(subscriber.crm_json, {});
    const progress = crm.lectureProgress || {};
    const [courses] = await pool.query(
      `SELECT e.course_id, c.title
         FROM enrollments e JOIN courses c ON c.id=e.course_id AND c.tenant_id=e.tenant_id
        WHERE e.subscriber_id=? AND e.tenant_id=?`,
      [subscriber.id, tenantId]
    );
    const courseStats = [];
    for (const course of courses) {
      const [lectures] = await pool.query(
        'SELECT id, title FROM course_lectures WHERE course_id=? AND is_published=1 ORDER BY sort_order',
        [course.course_id]
      );
      const completed = lectures.filter(lecture => Number(progress[lecture.id] || 0) >= 90).length;
      courseStats.push({
        courseId: course.course_id,
        courseTitle: course.title,
        total: lectures.length,
        completed,
        pct: lectures.length ? Math.round((completed / lectures.length) * 100) : 0,
      });
    }
    res.json({ crmProgress: progress, courseStats });
  } catch (error) {
    logger.error('[admin-progress]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Client: get own payment proofs
router.get('/api/me/payment-proofs', requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const tenantId = tenantIdFor(req);
    const [[sub]] = await pool.query(
      'SELECT id FROM subscribers WHERE tenant_id=? AND (firebase_uid = ? OR LOWER(TRIM(email)) = ?) LIMIT 1',
      [tenantId, uid || '', String(email || '').toLowerCase().trim()]
    );
    if (!sub) return res.json([]);
    const [rows] = await pool.query(
      'SELECT id, order_id, item_type, amount, currency, course_id, bundle_id, payment_method, note, status, reviewer_note, submitted_at, reviewed_at FROM payment_proofs WHERE subscriber_id = ? AND tenant_id=? ORDER BY submitted_at DESC LIMIT 100',
      [sub.id, tenantId]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: list payment proofs (default: pending only)
router.get('/api/admin/payment-proofs', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const tenantId = tenantIdFor(req);
    const statusFilter = req.query.status; // 'PENDING' | 'APPROVED' | 'REJECTED' | undefined (all)
    let sql = `SELECT pp.*, s.name AS subscriber_name, s.phone AS subscriber_phone, s.email AS subscriber_email,
               c.title AS course_title
               FROM payment_proofs pp
               LEFT JOIN subscribers s ON s.id = pp.subscriber_id
               LEFT JOIN courses c ON c.id = pp.course_id
               WHERE pp.tenant_id=?`;
    const params = [tenantId];
    if (statusFilter) { sql += ' AND pp.status = ?'; params.push(statusFilter.toUpperCase()); }
    sql += ' ORDER BY pp.submitted_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: approve or reject a payment proof
router.patch('/api/admin/payment-proofs/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { id } = req.params;
    const { action, reviewer_note } = req.body; // action: 'approve' | 'reject'
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });
    const tenantId = tenantIdFor(req);
    await conn.beginTransaction();
    transactionStarted = true;
    const [[proof]] = await conn.query(
      `SELECT pp.id, pp.order_id, pp.subscriber_id, pp.course_id, pp.bundle_id, pp.item_type,
              pp.amount, pp.currency, pp.payment_method, pp.proof_image, pp.note, pp.status,
              pp.branch_id, o.item_id, o.item_title, o.notes AS order_notes,
              o.customer_name, o.customer_email, o.customer_phone, o.status AS order_status,
              s.lead_id, s.branch
         FROM payment_proofs pp
         JOIN orders o ON o.id=pp.order_id AND o.tenant_id=pp.tenant_id
         JOIN subscribers s ON s.id=pp.subscriber_id AND s.tenant_id=pp.tenant_id
        WHERE pp.id=? AND pp.tenant_id=? LIMIT 1 FOR UPDATE`,
      [id, tenantId]
    );
    if (!proof) { await conn.rollback(); transactionStarted = false; return res.status(404).json({ error: 'Proof not found' }); }
    if (proof.status !== 'PENDING') { await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'Already reviewed' }); }
    if (proof.order_status !== 'pending') { await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'Order is not pending' }); }

    const reviewed_at = new Date();
    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
    await conn.query(
      `UPDATE payment_proofs SET status=?, reviewer_id=?, reviewer_note=?, reviewed_at=? WHERE id=? AND tenant_id=?`,
      [newStatus, req.user?.uid || req.user?.email || null, reviewer_note || null, reviewed_at, id, tenantId]
    );

    if (action === 'approve') {
      const [[reviewer]] = await conn.query(
        'SELECT id, name FROM staff WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1',
        [tenantId, String(req.user?.email || '').toLowerCase().trim()]
      );
      const reviewerName = reviewer?.name || req.user?.email?.split('@')[0] || null;
      const normalizedType = String(proof.item_type || 'other').toUpperCase();
      const paymentType = ['COURSE', 'BUNDLE', 'CONSULTATION', 'CERTIFICATE'].includes(normalizedType) ? normalizedType : 'OTHER';
      const payId = `proof-${proof.id}`;
      await assertWritable(new Date().toISOString().slice(0, 10), conn, tenantId);
      await conn.query(
        `INSERT INTO payments
           (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
            transaction_id, is_installment, course_expected, note, date, status, staff_id, staff_name,
            source, item_title, branch, branch_id, tenant_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,0,?,?,NOW(),'paid',?,?,?,?,?,?,?,?,NOW())`,
        [payId, proof.subscriber_id, proof.course_id || null, proof.bundle_id || null,
         proof.amount, proof.currency || 'EGP', paymentType, proof.payment_method || 'تحويل', proof.id,
         proof.amount,
         `تم اعتماد الإيصال${reviewer_note ? ' — ' + reviewer_note : ''}${proof.note ? ' | ملاحظة العميل: ' + proof.note : ''}`,
         reviewer?.id || null, reviewerName, 'manual_transfer', proof.item_title,
         proof.branch || branchForId(proof.branch_id), proof.branch_id || 'branch-other', tenantId]
      );
      const journalId = await postPaymentJournal({
        paymentId: payId,
        amount: proof.amount,
        currency: proof.currency || 'EGP',
        payType: paymentType,
        actor: req.user?.email || 'system',
        tenantId,
      }, conn);
      if (!journalId) throw new Error('Payment proof journal posting failed');

      if (paymentType === 'COURSE' && proof.course_id) {
        const [[course]] = await conn.query('SELECT id FROM courses WHERE id=? AND tenant_id=? LIMIT 1', [proof.course_id, tenantId]);
        if (!course) throw new Error('Paid course does not exist in tenant');
        await conn.query(
          `INSERT INTO enrollments (id, subscriber_id, course_id, enrolled_at, access_type, tenant_id, branch_id)
           SELECT ?,?,?,NOW(),'full',?,?
           WHERE NOT EXISTS (SELECT 1 FROM enrollments WHERE subscriber_id=? AND course_id=? AND tenant_id=?)`,
          [uuidv4(), proof.subscriber_id, proof.course_id, tenantId, proof.branch_id || 'branch-other',
           proof.subscriber_id, proof.course_id, tenantId]
        );
      } else if (paymentType === 'BUNDLE' && proof.bundle_id) {
        const [bundleCourses] = await conn.query(
          `SELECT bc.course_id FROM bundle_courses bc
             JOIN courses c ON c.id=bc.course_id AND c.tenant_id=?
             JOIN bundles b ON b.id=bc.bundle_id AND b.tenant_id=?
            WHERE bc.bundle_id=?`,
          [tenantId, tenantId, proof.bundle_id]
        );
        if (!bundleCourses.length) throw new Error('Paid bundle has no tenant courses');
        for (const row of bundleCourses) {
          await conn.query(
            `INSERT INTO enrollments (id, subscriber_id, course_id, bundle_id, enrolled_at, access_type, tenant_id, branch_id)
             SELECT ?,?,?,?,?, 'full',?,?
             WHERE NOT EXISTS (SELECT 1 FROM enrollments WHERE subscriber_id=? AND course_id=? AND tenant_id=?)`,
            [uuidv4(), proof.subscriber_id, row.course_id, proof.bundle_id, reviewed_at,
             tenantId, proof.branch_id || 'branch-other', proof.subscriber_id, row.course_id, tenantId]
          );
        }
      } else if (paymentType === 'CONSULTATION') {
        const extra = tryJson(proof.order_notes, {});
        await conn.query(
          `INSERT INTO consultations
             (id, client_name, client_email, client_phone, therapist_id, session_type, session_date,
              status, notes, amount, currency, subscriber_id, tenant_id, branch_id, created_at)
           VALUES (?,?,?,?,?,?,COALESCE(NULLIF(?,''),NOW()),'PENDING',?,?,?,?,?,?,NOW())`,
          [uuidv4(), proof.customer_name, proof.customer_email, proof.customer_phone,
           extra.therapistId || null, String(extra.sessionType || 'INDIVIDUAL').toUpperCase(),
           extra.sessionDate || '', `Manual order ${proof.order_id}`, proof.amount, proof.currency || 'EGP',
           proof.subscriber_id, tenantId, proof.branch_id || 'branch-other']
        );
      } else if (paymentType === 'CERTIFICATE') {
        const [result] = await conn.query(
          `UPDATE certificate_requests SET status='PAID', paid_amount=?, currency=?
            WHERE id=? AND subscriber_id=? AND tenant_id=? AND status IN ('PENDING','PRICED')`,
          [proof.amount, proof.currency || 'EGP', proof.item_id, proof.subscriber_id, tenantId]
        );
        if (!result.affectedRows) throw new Error('Certificate request is not eligible for payment');
      }

      await conn.query('UPDATE subscribers SET is_active=1 WHERE id=? AND tenant_id=?', [proof.subscriber_id, tenantId]);
      if (proof.lead_id) {
        await transitionLead({
          tenantId, leadId: proof.lead_id, toStatus: 'converted', db: conn,
          actor: req.user?.email || req.staffRecord?.name || 'payment-proof',
          reason: 'Lead converted after payment proof approval',
          metadata: { paymentProofId: proof.id, subscriberId: proof.subscriber_id },
        });
      }
      await conn.query(
        "UPDATE orders SET status='paid', transaction_id=?, paid_at=NOW(), updated_at=NOW() WHERE id=? AND tenant_id=?",
        [proof.id, proof.order_id, tenantId]
      );
      await enqueueFinanceEvent({
        tenantId, eventType: 'sync_lead_deal_value', refType: 'payment-proof', refId: proof.id,
        payload: { subscriberId: proof.subscriber_id },
      }, conn);
    }

    await conn.commit();
    transactionStarted = false;

    // Send WhatsApp notification to subscriber (best-effort, after commit)
    try {
      const [[sub]] = await pool.query('SELECT name, phone, email FROM subscribers WHERE id = ? AND tenant_id=?', [proof.subscriber_id, tenantId]);
      // Lifecycle: email receipt on approval (whatsapp handled just below to avoid dup).
      if (action === 'approve' && sub?.email) {
        require('../lib/lifecycle').trigger('payment_received',
          { name: sub.name, email: sub.email, amount: proof.amount, currency: proof.currency || 'EGP', itemTitle: proof.course_title, tenantId: req.tenantId },
          { channels: ['email'] });
      }
      if (sub?.phone) {
        const statusAr = action === 'approve' ? 'تم اعتماد' : 'تم رفض';
        const msg = action === 'approve'
          ? `✅ مرحباً ${sub.name || ''}، ${statusAr} إيصال دفعتك بمبلغ ${proof.amount} ${proof.currency || 'EGP'}. شكراً لك! 🎓`
          : `❌ مرحباً ${sub.name || ''}، ${statusAr} إيصال دفعتك بمبلغ ${proof.amount} ${proof.currency || 'EGP'}.${reviewer_note ? '\nالسبب: ' + reviewer_note : ''} يرجى التواصل معنا للمساعدة.`;
        await sendWhatsApp(sub.phone, msg, { tenantId: req.tenantId });
      }
      if (sub?.email) {
        publishRealtimeEvent('client:payment-updated', {
          status: newStatus,
          amount: proof.amount,
          currency: proof.currency || 'EGP',
          message: action === 'approve' ? 'تم اعتماد إيصال الدفع وتحديث حسابك.' : 'تم رفض إيصال الدفع. برجاء مراجعة الملاحظة.',
        }, { room: `user:${String(sub.email).toLowerCase().trim()}` }).catch(() => {});
      }
    } catch (notifyErr) {
      logger.warn('[payment-proof] WhatsApp notify failed:', notifyErr.message);
    }

    res.json({ ok: true, status: newStatus });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// Admin: get single payment proof image (with auth check)
router.get('/api/admin/payment-proofs/:id/image', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT proof_image FROM payment_proofs WHERE id = ? AND tenant_id=?', [req.params.id, tenantIdFor(req)]);
    if (!row || !row.proof_image) return res.status(404).json({ error: 'No image' });
    res.json({ image: row.proof_image });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


module.exports = router;
