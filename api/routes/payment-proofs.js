'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { tryJson } = require('../lib/helpers');
const { ensureSubscriberForOrder } = require('../lib/subscriberProvisioning');
const { postPaymentJournal } = require('../lib/finance');
const { assertWritable } = require('../lib/periodLock');
const { sendWhatsApp } = require('../lib/whatsapp');
const { enqueueFinanceEvent } = require('../lib/financeOutbox');
const { createNotification } = require('../lib/notification');
const { transitionLead } = require('../lib/leadState');
const { publishRealtimeEvent } = require('../lib/realtime');
const { completeCourse } = require('../lib/courseCompletion');
const { recordLectureProgress } = require('../lib/learningProgress');
const { resolveLectureAccess } = require('../lib/learningAccess');
const { grantCourseSelections } = require('../lib/entitlements');
const { financialRecordMatches, resolveFinancialScope } = require('../lib/financialScope');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { inspectProofImageDataUrl } = require('../lib/uploadSafety');
const { isJourneyState } = require('../lib/journeyStates');
const { dateOnlyInTimeZone } = require('../lib/dates');
const { logFinancialAudit, logPaymentAudit } = require('../lib/finance');
const { recordPaymentCompensation } = require('../lib/paymentCompensation');
const {
  createPaymentAttempt,
  getOrCreatePaymentIntent,
  settlePaymentAttempt,
} = require('../lib/paymentIntents');
const { getTenantSetting } = require('../lib/tenantSettings');
const { classifyPaymentProof, paymentProofReviewStep } = require('../lib/paymentProofReview');

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

const isPendingOrder = status => isJourneyState('order', status, 'pending');

// ── Payment Proofs — client submits & admin reviews ───────────────────────────

// Client: submit a payment proof (instapay / bank transfer receipt)
router.post('/api/me/payment-proof', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { uid, email } = req.user;
    const tenantId = tenantIdFor(req);
    const normalizedEmail = String(email || '').toLowerCase().trim();
    const { order_id, payment_intent_id, payment_method, proof_image, note } = req.body || {};
    if (!order_id) return res.status(400).json({ error: 'order_id required' });
    // Ownership of the order is proven by the subscriber link or by the email on
    // the order. Requiring the email outright locked out every WhatsApp-only
    // client: they could place an order and then never submit its receipt.
    const identity = await resolveSubscriberRow(req, ['id', 'email']);
    const ownerEmail = normalizedEmail || String(identity?.email || '').toLowerCase().trim();
    if (!identity && !ownerEmail) return res.status(400).json({ error: 'authenticated identity required' });
    // Validate proof_image: must be a base64 image (data:image/...) or null
    if (proof_image) {
      if (typeof proof_image !== 'string') return res.status(400).json({ error: 'Invalid proof image' });
      if (proof_image.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max 5MB base64)' });
      // Only allow image MIME types — reject SVG (XSS risk) and non-image data URIs
      try { inspectProofImageDataUrl(proof_image); }
      catch (error) { return res.status(400).json({ error: error.message }); }
    }
    const safeNote = note ? String(note).slice(0, 500) : null;
    await conn.beginTransaction();
    transactionStarted = true;
    const ownership = [];
    const ownershipParams = [];
    if (identity?.id) { ownership.push('subscriber_id=?'); ownershipParams.push(identity.id); }
    if (ownerEmail) { ownership.push('LOWER(TRIM(customer_email))=?'); ownershipParams.push(ownerEmail); }
    const [[order]] = await conn.query(
      `SELECT id, type, item_id, item_title, amount, currency, customer_name, customer_email,
              customer_phone, status, subscriber_id, course_id, bundle_id, tenant_id, branch_id
         FROM orders
        WHERE id=? AND tenant_id=? AND (${ownership.join(' OR ')}) LIMIT 1 FOR UPDATE`,
      [order_id, tenantId, ...ownershipParams]
    );
    if (!order) { await conn.rollback(); transactionStarted = false; return res.status(404).json({ error: 'Order not found' }); }
    if (!isPendingOrder(order.status)) { await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'Order is not pending payment' }); }
    if (Number(order.amount) <= 0 || Number(order.amount) > 500000) {
      await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'Order amount is invalid' });
    }
    const [[existingProof]] = await conn.query(
      `SELECT id
       FROM payment_proofs
       WHERE order_id=? AND tenant_id=? AND status IN ('PENDING','APPROVED')
       LIMIT 1 FOR UPDATE`,
      [order.id, tenantId]
    );
    if (existingProof) { await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'A payment proof already exists for this order' }); }

    const sub = await ensureSubscriberForOrder(conn, {
      tenantId, uid, email: ownerEmail, name: order.customer_name, phone: order.customer_phone,
      fallbackBranch: branchForId(order.branch_id),
      fallbackBranchId: order.branch_id,
    });
    await conn.query('UPDATE orders SET subscriber_id=? WHERE id=? AND tenant_id=?', [sub.id, order.id, tenantId]);

    const id = `pp-${uuidv4()}`;
    const intent = await getOrCreatePaymentIntent(conn, {
      tenantId, order, subscriberId: sub.id, actor: uid || ownerEmail,
      idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotency_key,
      requestedIntentId: payment_intent_id || null,
    });
    const attemptId = await createPaymentAttempt(conn, {
      tenantId, intentId: intent.id, proofId: id, actor: uid || ownerEmail,
    });
    const reviewPolicy = await getTenantSetting('payment_review_policy', {
      tenantId, fallback: {}, db: conn,
    });
    const review = classifyPaymentProof({
      amount: order.amount, currency: order.currency || 'EGP', policy: reviewPolicy,
    });
    const reviewDueAt = new Date(Date.now() + review.slaHours * 60 * 60 * 1000);
    await conn.query(
      `INSERT INTO payment_proofs
         (id, order_id, payment_intent_id, payment_attempt_id, subscriber_id, course_id, bundle_id, item_type, amount, currency,
          payment_method, proof_image, note, review_due_at, risk_level, second_review_required, tenant_id, branch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, order.id, intent.id, attemptId, sub.id, order.course_id || null, order.bundle_id || null,
       String(order.type || 'OTHER').toLowerCase(), order.amount, order.currency || 'EGP',
       String(payment_method || 'instapay').slice(0, 50), proof_image || null, safeNote, reviewDueAt,
       review.riskLevel, review.secondReviewRequired ? 1 : 0,
       tenantId, order.branch_id || sub.branch_id || 'branch-other']
    );
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, id, payment_intent_id: intent.id, payment_attempt_id: attemptId });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// PATCH /api/me/progress — client saves their own lecture progress (no admin needed)
router.patch('/api/me/progress', requireAuth, async (req, res) => {
  try {
    const tenantId = tenantIdFor(req);
    const { lectureId, pct, watchSeconds } = req.body || {};
    if (!lectureId || pct === undefined) return res.status(400).json({ error: 'lectureId and pct required' });
    const progress = Math.min(100, Math.max(0, Number(pct) || 0));
    const sub = await resolveSubscriberRow(req, ['id', 'name']);
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    const actor = req.user?.email || req.user?.uid || sub.id;
    const savedProgress = await recordLectureProgress({
      tenantId, subscriberId: sub.id, lectureId, progress, watchSeconds,
    });
    // ── Auto-complete: delegate to the shared completeCourse() (LMS-07) instead
    // of reimplementing eligibility/cert-issuing here — this used to duplicate
    // (and drift from) lib/courseCompletion.js's own entitlement + progress
    // checks and email template, the same class of bug the refund logic had
    // before it was unified (PAY-04/05/14).
    let completionData = null;
    if (progress >= 100) {
      try {
        if (savedProgress.courseId) {
          const completion = await completeCourse({
            tenantId, subscriberId: sub.id, courseId: savedProgress.courseId, actor, requireFullProgress: true,
          });
          if (!completion.alreadyCompleted) {
            const [[course]] = await pool.query('SELECT title FROM courses WHERE id=? AND tenant_id=? LIMIT 1', [savedProgress.courseId, tenantId]);
            await createNotification('certificate', 'إتمام كورس', `${sub.name || actor} أتم كورس "${course?.title || ''}"`, { courseId: savedProgress.courseId, certCode: completion.certificate_code }, req.tenantId);
            completionData = { completed: true, certCode: completion.certificate_code };
          }
        }
      } catch (cerr) {
        // completeCourse() throws 409 whenever this lecture reached 100% but the
        // course as a whole isn't done yet (other lectures still pending) — an
        // expected, frequent outcome here, not a real error worth logging.
        if (cerr.statusCode !== 409) logger.warn('[progress] completion check error:', cerr.message);
      }
    }
    res.json({ ok: true, ...(completionData || {}) });
  } catch (e) {
    logger.error('[progress]', e.message);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' });
  }
});

router.get('/api/admin/subscribers/:id/progress', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const tenantId = tenantIdFor(req);
    const [[subscriber]] = await pool.query(
      'SELECT id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
      [req.params.id, tenantId]
    );
    if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });
    const [courses] = await pool.query(
      `SELECT e.course_id, c.title
         FROM enrollments e JOIN courses c ON c.id=e.course_id AND c.tenant_id=e.tenant_id
        WHERE e.subscriber_id=? AND e.tenant_id=? AND e.status='active'`,
      [subscriber.id, tenantId]
    );
    // Batched instead of one course_lectures query per enrolled course (PERF-01).
    const courseIds = courses.map(course => course.course_id);
    const lecturesByCourse = new Map();
    const progress = {};
    if (courseIds.length) {
      const [allLectures] = await pool.query(
        `SELECT cl.id,cl.title,cl.course_id,COALESCE(lc.progress_pct,0) AS progress_pct
         FROM course_lectures cl
         LEFT JOIN lecture_completions lc ON lc.lecture_id=cl.id AND lc.subscriber_id=? AND lc.tenant_id=?
         WHERE cl.course_id IN (${courseIds.map(() => '?').join(',')}) AND cl.is_published=1
         ORDER BY cl.sort_order`,
        [subscriber.id, tenantId, ...courseIds]
      );
      for (const lecture of allLectures) {
        progress[lecture.id] = Number(lecture.progress_pct || 0);
        if (!lecturesByCourse.has(lecture.course_id)) lecturesByCourse.set(lecture.course_id, []);
        lecturesByCourse.get(lecture.course_id).push(lecture);
      }
    }
    const courseStats = courses.map(course => {
      const lectures = lecturesByCourse.get(course.course_id) || [];
      const completed = lectures.filter(lecture => Number(progress[lecture.id] || 0) >= 100).length;
      return {
        courseId: course.course_id,
        courseTitle: course.title,
        total: lectures.length,
        completed,
        pct: lectures.length ? Math.round((completed / lectures.length) * 100) : 0,
      };
    });
    res.json({ lectureProgress: progress, courseStats });
  } catch (error) {
    logger.error('[admin-progress]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Client: get own payment proofs
router.get('/api/me/payment-proofs', requireAuth, async (req, res) => {
  try {
    const tenantId = tenantIdFor(req);
    const sub = await resolveSubscriberRow(req, ['id']);
    if (!sub) return res.json([]);
    const [rows] = await pool.query(
      'SELECT id, order_id, payment_intent_id, payment_attempt_id, item_type, amount, currency, course_id, bundle_id, payment_method, note, status, reviewer_note, submitted_at, reviewed_at FROM payment_proofs WHERE subscriber_id = ? AND tenant_id=? ORDER BY submitted_at DESC LIMIT 100',
      [sub.id, tenantId]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin: list payment proofs (default: pending only)
router.get('/api/admin/payment-proofs', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const tenantId = tenantIdFor(req);
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const statusFilter = req.query.status; // 'PENDING' | 'APPROVED' | 'REJECTED' | undefined (all)
    const normalizedStatus = statusFilter ? String(statusFilter).toUpperCase() : null;
    if (normalizedStatus && !['PENDING', 'APPROVED', 'REJECTED'].includes(normalizedStatus)) {
      return res.status(400).json({ error: 'Invalid payment proof status' });
    }
    let sql = `SELECT pp.*, s.name AS subscriber_name, s.phone AS subscriber_phone, s.email AS subscriber_email,
               c.title AS course_title,
               CASE
                 WHEN pp.status<>'PENDING' THEN 'completed'
                 WHEN pp.review_due_at<NOW() THEN 'breached'
                 WHEN pp.review_due_at<DATE_ADD(NOW(),INTERVAL 60 MINUTE) THEN 'due_soon'
                 ELSE 'within_sla'
               END AS sla_state
               FROM payment_proofs pp
               LEFT JOIN subscribers s ON s.id = pp.subscriber_id AND s.tenant_id=pp.tenant_id
               LEFT JOIN courses c ON c.id = pp.course_id AND c.tenant_id=pp.tenant_id
               WHERE pp.tenant_id=?`;
    const params = [tenantId];
    if (scope.branchId) { sql += ' AND pp.branch_id=?'; params.push(scope.branchId); }
    if (normalizedStatus) { sql += ' AND pp.status = ?'; params.push(normalizedStatus); }
    sql += ' ORDER BY pp.submitted_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

router.get('/api/me/lecture-notes/:lectureId', requireAuth, async (req, res) => {
  try {
    const tenantId = tenantIdFor(req);
    const sub = await resolveSubscriberRow(req, ['id']);
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    const access = await resolveLectureAccess({ tenantId, subscriberId: sub.id, lectureId: req.params.lectureId });
    if (!access.accessible) return res.status(403).json({ error: `Lecture access denied: ${access.reason}` });
    const [[row]] = await pool.query(
      'SELECT note_text FROM lecture_completions WHERE tenant_id=? AND subscriber_id=? AND lecture_id=? LIMIT 1',
      [tenantId, sub.id, req.params.lectureId]
    );
    res.json({ note: row?.note_text || '' });
  } catch (error) {
    logger.error('[lecture-notes:get]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/me/lecture-notes/:lectureId', requireAuth, async (req, res) => {
  try {
    const tenantId = tenantIdFor(req);
    const note = String(req.body?.note || '').slice(0, 10000);
    const sub = await resolveSubscriberRow(req, ['id']);
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    const access = await resolveLectureAccess({ tenantId, subscriberId: sub.id, lectureId: req.params.lectureId });
    if (!access.accessible) return res.status(403).json({ error: `Lecture access denied: ${access.reason}` });
    await pool.query(
      `INSERT INTO lecture_completions
         (id,tenant_id,subscriber_id,lecture_id,course_id,progress_pct,watch_seconds,note_text)
       VALUES (UUID(),?,?,?,?,0,0,?)
       ON DUPLICATE KEY UPDATE note_text=VALUES(note_text),tenant_id=VALUES(tenant_id)`,
      [tenantId, sub.id, req.params.lectureId, access.lecture.course_id, note]
    );
    res.json({ ok: true });
  } catch (error) {
    logger.error('[lecture-notes:put]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: approve or reject a payment proof
router.patch('/api/admin/payment-proofs/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { id } = req.params;
    const { action, reviewer_note } = req.body; // action: 'approve' | 'reject'
    const scope = resolveFinancialScope(req, { requestedBranch: req.body.branch || null });
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });
    if (String(reviewer_note || '').length > 2000) return res.status(400).json({ error: 'reviewer_note is too long' });
    const tenantId = tenantIdFor(req);
    await conn.beginTransaction();
    transactionStarted = true;
    const [[proof]] = await conn.query(
      `SELECT pp.id, pp.order_id, pp.subscriber_id, pp.course_id, pp.bundle_id, pp.item_type,
              pp.amount, pp.currency, pp.payment_method, pp.proof_image, pp.note, pp.status,
              pp.branch_id, pp.payment_intent_id, pp.payment_attempt_id, pp.second_review_required,
              pp.first_reviewer_id, pp.first_review_note, pp.first_reviewed_at, pp.review_due_at, pp.risk_level,
              o.item_id, o.item_title, o.notes AS order_notes,
              o.customer_name, o.customer_email, o.customer_phone, o.status AS order_status,
               s.lead_id, s.branch, s.assigned_sales_id
         FROM payment_proofs pp
         JOIN orders o ON o.id=pp.order_id AND o.tenant_id=pp.tenant_id
         JOIN subscribers s ON s.id=pp.subscriber_id AND s.tenant_id=pp.tenant_id
        WHERE pp.id=? AND pp.tenant_id=? LIMIT 1 FOR UPDATE`,
      [id, tenantId]
    );
    if (!proof) { await conn.rollback(); transactionStarted = false; return res.status(404).json({ error: 'Proof not found' }); }
    if (!financialRecordMatches(scope, proof)) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(403).json({ error: 'Payment proof is outside your financial scope' });
    }
    if (proof.status !== 'PENDING') { await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'Already reviewed' }); }
    if (!isPendingOrder(proof.order_status)) { await conn.rollback(); transactionStarted = false; return res.status(409).json({ error: 'Order is not pending' }); }

    const actorId = req.staffRecord?.id || req.user?.uid || req.user?.email || 'system';
    const reviewStep = paymentProofReviewStep({
      action,
      secondReviewRequired: Boolean(proof.second_review_required),
      firstReviewerId: proof.first_reviewer_id,
      actorId,
    });
    const reviewed_at = new Date();
    if (reviewStep === 'first_approve') {
      await conn.query(
        `UPDATE payment_proofs
            SET first_reviewer_id=?,first_review_note=?,first_reviewed_at=?
          WHERE id=? AND tenant_id=? AND status='PENDING' AND first_reviewer_id IS NULL`,
        [actorId, reviewer_note || null, reviewed_at, id, tenantId]
      );
      await logFinancialAudit({
        entityType: 'payment_proof',
        entityId: proof.id,
        action: 'first_approved',
        oldData: { status: proof.status, first_reviewer_id: null },
        newData: { status: 'PENDING', first_reviewer_id: actorId, second_review_required: true },
        amount: proof.amount,
        actor: req.user?.email || actorId,
        tenantId,
        db: conn,
        strict: true,
      });
      await conn.commit();
      transactionStarted = false;
      return res.json({
        ok: true,
        status: 'PENDING',
        pendingSecondApproval: true,
        review_due_at: proof.review_due_at,
      });
    }
    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
    await conn.query(
      `UPDATE payment_proofs SET status=?, reviewer_id=?, reviewer_note=?, reviewed_at=? WHERE id=? AND tenant_id=?`,
      [newStatus, actorId, reviewer_note || null, reviewed_at, id, tenantId]
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
      await assertWritable(dateOnlyInTimeZone(), conn, tenantId);
      await conn.query(
        `INSERT INTO payments
           (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
            transaction_id, is_installment, course_expected, note, date, status, staff_id, staff_name,
            source, item_title, branch, branch_id, tenant_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,0,?,?,NOW(),'paid',?,?,?,?,?,?,?,NOW())`,
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
      await logPaymentAudit(
        payId, 'create', null, 'paid', proof.amount, proof.subscriber_id,
        req.user?.email || 'system', tenantId, conn, true,
      );
      await recordPaymentCompensation({
        paymentId: payId,
        tenantId,
        commissionStaffId: proof.assigned_sales_id || null,
        actor: reviewer?.id || req.user?.email || 'system',
      }, conn);

      if ((paymentType === 'COURSE' && proof.course_id) || (paymentType === 'BUNDLE' && proof.bundle_id)) {
        await grantCourseSelections({
          tenantId, subscriberId: proof.subscriber_id,
          selections: [{ courseId: paymentType === 'BUNDLE' ? `bundle:${proof.bundle_id}` : proof.course_id, accessType: 'full' }],
          branchId: proof.branch_id || 'branch-other', source: 'payment_proof',
          actor: req.user?.email || 'system',
        }, conn);
      } else if (paymentType === 'CONSULTATION') {
        const extra = tryJson(proof.order_notes, {});
        const [updatedConsultation] = await conn.query(
          `UPDATE consultations
              SET status='CONFIRMED',amount=?,currency=?,subscriber_id=?,updated_at=NOW()
            WHERE id=? AND tenant_id=? AND deleted_at IS NULL AND status IN ('PENDING','CONFIRMED')`,
          [proof.amount, proof.currency || 'EGP', proof.subscriber_id, proof.item_id, tenantId]
        );
        if (!updatedConsultation.affectedRows) await conn.query(
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

    if (proof.payment_intent_id && proof.payment_attempt_id) {
      await settlePaymentAttempt(conn, {
        tenantId,
        intentId: proof.payment_intent_id,
        attemptId: proof.payment_attempt_id,
        approved: action === 'approve',
        paymentId: action === 'approve' ? `proof-${proof.id}` : null,
        failureCode: action === 'reject' ? 'PROOF_REJECTED' : null,
      });
    }

    await logFinancialAudit({
      entityType: 'payment_proof',
      entityId: proof.id,
      action: action === 'approve' ? 'approved' : 'rejected',
      oldData: { status: proof.status },
      newData: { status: newStatus, reviewer_note: reviewer_note || null },
      amount: proof.amount,
      actor: req.user?.email || 'system',
      tenantId,
      db: conn,
      strict: true,
    });

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
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  } finally { conn.release(); }
});

// Admin: get single payment proof image (with auth check)
router.get('/api/admin/payment-proofs/:id/image', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const [[row]] = await pool.query(
      'SELECT proof_image, branch_id FROM payment_proofs WHERE id = ? AND tenant_id=?',
      [req.params.id, tenantIdFor(req)]
    );
    if (!row || !row.proof_image) return res.status(404).json({ error: 'No image' });
    if (!financialRecordMatches(scope, row)) return res.status(403).json({ error: 'Payment proof is outside your financial scope' });
    res.json({ image: row.proof_image });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});


module.exports = router;
