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
const { COURSE_COLS, mapCourse, mapBundle, mapTherapist, getNextClientCode, mapQuiz } = require('../../lib/mappers');
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
const { getNextSalesRep } = require('../../lib/leadAssignment');
const { branchIdForBranch } = require('../../lib/branches');
const { normalizeQuizDefinition } = require('../../lib/quizValidation');

// ── Initialize extra tables on startup ───────────────────────────────────────
// ── Initialize extra tables on startup ───────────────────────────────────────
// Schema for core/catalog tables is owned by numbered migrations.


// ── DELETE endpoints for basic entities ───────────────────────────────────────
router.delete('/api/admin/subscribers/:id', requireAuth, requireAdminOrStaff, requirePermission('delete_subscribers'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[sub]] = await conn.query(
      'SELECT id, email, phone FROM subscribers WHERE id=? AND tenant_id=? FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!sub) {
      await conn.rollback();
      return res.status(404).json({ error: 'Subscriber not found' });
    }

    // Preserve payments, orders, enrollments and audit history. "Delete" is an
    // archive/deactivation operation; legal erasure remains a separate workflow.
    await conn.query(
      'UPDATE subscribers SET is_active=0, deleted_at=NOW(), updated_at=NOW() WHERE id=? AND tenant_id=?',
      [req.params.id, req.tenantId]
    );

    if (sub.email) {
      const normEmail = sub.email.toLowerCase().trim();
      await conn.query(
        "UPDATE users SET is_active=0 WHERE tenant_id=? AND LOWER(TRIM(email))=? AND role='user'",
        [req.tenantId, normEmail]
      );
    }

    await conn.commit();
    logger.info(`[delete-subscriber] archived id=${sub.id} tenant=${req.tenantId}`);
    res.json({ ok: true, archived: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
  finally { conn.release(); }
});
router.delete('/api/admin/lectures/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE cl FROM course_lectures cl JOIN courses c ON c.id=cl.course_id WHERE cl.id=? AND c.tenant_id=?', [req.params.id, req.tenantId]); cacheInvalidate('courses', 'lectures', 'chapters'); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/chapters/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE ch FROM course_chapters ch JOIN courses c ON c.id=ch.course_id WHERE ch.id=? AND c.tenant_id=?', [req.params.id, req.tenantId]); cacheInvalidate('courses', 'lectures', 'chapters'); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
// GET /api/admin/therapists — all therapists (including inactive) with slots
router.get('/api/admin/therapists', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [therapists] = await pool.query(
      `SELECT id, staff_id, name, specialty, image, experience, rating, title, bio,
       price_egp, price_sar, price_usd, is_consultation_enabled, session_duration_minutes,
       meeting_provider, provider_base_url, featured, sort_order, show_on_home, show_on_about,
       is_active, languages_json, focus_areas_json, qualifications_json, created_at
       FROM therapists WHERE tenant_id = ? ORDER BY sort_order ASC, name ASC`, [req.tenantId]);
    if (therapists.length > 0) {
      const ids = therapists.map(t => t.id);
      const [slots] = await pool.query(
        `SELECT id, therapist_id, day, start_time, end_time, timezone, label, meeting_link, is_active
         FROM therapist_slots WHERE therapist_id IN (${ids.map(() => '?').join(',')}) ORDER BY day, start_time`, ids);
      const slotMap = {};
      slots.forEach(s => { (slotMap[s.therapist_id] = slotMap[s.therapist_id] || []).push(s); });
      therapists.forEach(t => { t.slots = slotMap[t.id] || []; });
    }
    res.json(therapists.map(mapTherapist));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' });
  }
});
router.delete('/api/admin/therapists/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM therapists WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Therapist not found' });
    cacheInvalidate('therapists'); res.json({ ok: true });
  }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/testimonials/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM testimonials WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Testimonial not found' });
    cacheInvalidate('testimonials'); res.json({ ok: true });
  }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Bundles CRUD ───────────────────────────────────────────────────────────────
router.get('/api/admin/bundles', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 200, 500);
    const [rows] = await pool.query(
      `SELECT b.*, GROUP_CONCAT(bc.course_id ORDER BY bc.sort_order) AS course_ids_csv
       FROM bundles b
       LEFT JOIN bundle_courses bc ON bc.bundle_id = b.id AND bc.tenant_id=b.tenant_id
       WHERE b.tenant_id = ?
       GROUP BY b.id
       ORDER BY b.sort_order ASC, b.created_at DESC LIMIT ?`, [req.tenantId, limit]
    );
    const [courses] = await pool.query(`SELECT ${COURSE_COLS} FROM courses WHERE is_published = 1 AND tenant_id = ?`, [req.tenantId]);
    const mappedCourses = courses.map(mapCourse);
    res.json(rows.map(r => mapBundle(r, mappedCourses)));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/bundles', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body;
    const id = b.id || uuidv4();
    const titleEn      = b.title_en      ?? b.titleEn      ?? null;
    const shortDesc    = b.short_description ?? b.shortDescription ?? '';
    const videoUrl     = b.video_url     ?? b.videoUrl     ?? null;
    const priceEGP     = b.price_egp     ?? b.price?.EGP   ?? 0;
    const priceSAR     = b.price_sar     ?? b.price?.SAR   ?? 0;
    const priceUSD     = b.price_usd     ?? b.price?.USD   ?? 0;
    const origEGP      = b.orig_price_egp  ?? b.originalPrice?.EGP ?? 0;
    const origSAR      = b.orig_price_sar  ?? b.originalPrice?.SAR ?? 0;
    const origUSD      = b.orig_price_usd  ?? b.originalPrice?.USD ?? 0;
    const detailsJson  = b.details_content_json ?? (b.detailsContent != null ? JSON.stringify(b.detailsContent) : null);
    const isPublished  = b.is_published != null ? (b.is_published ? 1 : 0) : (b.isPublished != null ? (b.isPublished ? 1 : 0) : 0);
    const sortOrder    = b.sort_order    ?? b.sortOrder    ?? 0;
    const courseIds    = b.course_ids    ?? b.courseIds    ?? null;
    if (b.id) {
      const [[anyRow]] = await pool.query('SELECT id, (tenant_id = ?) AS owned FROM bundles WHERE id=? LIMIT 1', [req.tenantId, b.id]);
      if (anyRow && !anyRow.owned) return res.status(404).json({ error: 'Bundle not found' });
    }
    await pool.query(
      `INSERT INTO bundles (id, tenant_id, title, title_en, slug, short_description, description, thumbnail, video_url,
         price_egp, price_sar, price_usd, orig_price_egp, orig_price_sar, orig_price_usd,
         details_content_json, is_published, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), title_en=VALUES(title_en), short_description=VALUES(short_description),
         description=VALUES(description), thumbnail=VALUES(thumbnail), video_url=VALUES(video_url),
         price_egp=VALUES(price_egp), price_sar=VALUES(price_sar), price_usd=VALUES(price_usd),
         orig_price_egp=VALUES(orig_price_egp), orig_price_sar=VALUES(orig_price_sar), orig_price_usd=VALUES(orig_price_usd),
         details_content_json=VALUES(details_content_json), is_published=VALUES(is_published),
         sort_order=VALUES(sort_order), updated_at=CURRENT_TIMESTAMP`,
      [id, req.tenantId, b.title||'', titleEn, b.slug||null, shortDesc, b.description||'',
       b.thumbnail||'', videoUrl,
       priceEGP, priceSAR, priceUSD, origEGP, origSAR, origUSD,
       detailsJson, isPublished, sortOrder]
    );
    // Sync courses into bundle_courses join table
    if (Array.isArray(courseIds)) {
      await pool.query('DELETE FROM bundle_courses WHERE tenant_id=? AND bundle_id = ?', [req.tenantId, id]);
      for (let i = 0; i < courseIds.length; i++) {
        await pool.query(
          `INSERT IGNORE INTO bundle_courses (bundle_id, course_id, tenant_id, sort_order)
           SELECT ?,c.id,?,? FROM courses c WHERE c.id=? AND c.tenant_id=? AND c.deleted_at IS NULL`,
          [id, req.tenantId, i, courseIds[i], req.tenantId]
        );
      }
    }
    cacheInvalidate('bundles');
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/bundles/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM bundles WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Bundle not found' });
    await pool.query('DELETE FROM bundle_courses WHERE tenant_id=? AND bundle_id = ?', [req.tenantId, req.params.id]);
    cacheInvalidate('bundles');
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Quizzes CRUD ──────────────────────────────────────────────────────────────
// Authenticated counterpart to the public GET /api/quizzes — returns the full
// question set including correctIndex so the admin editor can display/edit
// answers. The public route strips correctIndex entirely (LMS-05).
router.get('/api/admin/quizzes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 200, 500);
    const [rows] = await pool.query(
      `SELECT id, course_id, title, questions_json, passing_score, required_for_completion,
              generated_by_ai, source_material, created_at, updated_at
       FROM course_quizzes WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?`, [req.tenantId, limit]);
    res.json(rows.map(r => mapQuiz(r, { includeAnswers: true })));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/admin/quizzes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const q = req.body;
    const id = q.id || uuidv4();
    const courseId     = q.course_id    ?? q.courseId    ?? null;
    const { title, passingScore, questions } = normalizeQuizDefinition(q);
    const requiredForCompletion = (q.required_for_completion ?? q.requiredForCompletion) !== false;
    // course_id has FK constraint — only insert if a valid course_id is provided
    if (!courseId) return res.status(400).json({ error: 'course_id is required' });
    const [[course]] = await pool.query('SELECT id FROM courses WHERE id=? AND tenant_id=? LIMIT 1', [courseId, req.tenantId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (q.id) {
      const [[anyRow]] = await pool.query('SELECT id, (tenant_id = ?) AS owned FROM course_quizzes WHERE id=? LIMIT 1', [req.tenantId, q.id]);
      if (anyRow && !anyRow.owned) return res.status(404).json({ error: 'Quiz not found' });
    }
    await pool.query(
      `INSERT INTO course_quizzes
       (id,tenant_id,course_id,title,questions_json,passing_score,required_for_completion,created_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), questions_json=VALUES(questions_json),
         passing_score=VALUES(passing_score),required_for_completion=VALUES(required_for_completion),
         updated_at=CURRENT_TIMESTAMP`,
      [id, req.tenantId, courseId, title, JSON.stringify(questions), passingScore,
       requiredForCompletion ? 1 : 0,
       q.created_at||new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[quiz-save]', e.message);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' });
  }
});
router.delete('/api/admin/quizzes/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM course_quizzes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Quiz not found' });
    res.json({ ok: true });
  }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Live Streams CRUD ─────────────────────────────────────────────────────────
router.post('/api/admin/live-streams', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = req.body;
    const id = s.id || uuidv4();
    const streamUrl      = s.stream_url         ?? s.streamUrl         ?? '';
    const scheduledAt    = s.scheduled_at       ?? s.scheduledAt       ?? new Date().toISOString();
    const durationMins   = s.duration_minutes   ?? s.durationMinutes   ?? 60;
    const instructorName = s.instructor_name    ?? s.instructorName    ?? s.instructor ?? null;
    const targetIds      = s.target_course_ids_json ??
                           (Array.isArray(s.targetCourseIds) ? JSON.stringify(s.targetCourseIds) : null);
    const platform  = (s.platform  || 'ZOOM').toUpperCase().replace('-','_');
    const visibility= (s.visibility|| 'ALL_SUBSCRIBERS').toUpperCase().replace(/-/g,'_');
    const status    = (s.status    || 'UPCOMING').toUpperCase();
    if (s.id) {
      const [[anyRow]] = await pool.query('SELECT id, (tenant_id = ?) AS owned FROM live_streams WHERE id=? LIMIT 1', [req.tenantId, s.id]);
      if (anyRow && !anyRow.owned) return res.status(404).json({ error: 'Live stream not found' });
    }
    await pool.query(
      `INSERT INTO live_streams (id, tenant_id, title, instructor_name, scheduled_at, duration_minutes,
         stream_url, platform, visibility, target_course_ids_json, status, description, recording_url, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), instructor_name=VALUES(instructor_name),
         scheduled_at=VALUES(scheduled_at), stream_url=VALUES(stream_url),
         platform=VALUES(platform), visibility=VALUES(visibility),
         target_course_ids_json=VALUES(target_course_ids_json),
         status=VALUES(status), description=VALUES(description),
         recording_url=VALUES(recording_url)`,
      [id, req.tenantId, s.title||'', instructorName||'', scheduledAt, durationMins,
       streamUrl, platform, visibility, targetIds, status,
       s.description||null, s.recording_url||s.recordingUrl||null,
       s.created_at||new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/live-streams/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM live_streams WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Live stream not found' });
    res.json({ ok: true });
  }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Consultations CRUD ────────────────────────────────────────────────────────
router.post('/api/admin/consultations', requireAuth, requireAdmin, async (req, res) => {
  let conn;
  let transactionStarted = false;
  try {
    conn = await pool.getConnection();
    const c = req.body;
    const id = c.id || uuidv4();
    const therapistId = c.therapistId || c.therapist_id;
    const clientName = String(c.clientName || c.client_name || '').trim();
    const clientEmail = String(c.clientEmail || c.client_email || '').trim().toLowerCase();
    const clientPhone = String(c.clientPhone || c.client_phone || '').trim();
    const sessionDate = c.sessionDate || c.session_date;
    const sessionType = String(c.sessionType || c.session_type || 'individual').toUpperCase();
    const status = String(c.status || 'pending').toUpperCase();
    if (!clientName || !therapistId || !sessionDate) return res.status(400).json({ error: 'Client, therapist and session date are required' });
    if (!['INDIVIDUAL', 'COUPLE', 'FAMILY'].includes(sessionType)) return res.status(400).json({ error: 'Invalid session type' });
    if (!['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(status)) return res.status(400).json({ error: 'Invalid consultation status' });
    {
      const [[therapist]] = await conn.query('SELECT id, name FROM therapists WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1', [therapistId, req.tenantId]);
      if (!therapist) return res.status(404).json({ error: 'Therapist not found' });
    }
    let existing = null;
    if (c.id) {
      [[existing]] = await conn.query('SELECT tenant_id FROM consultations WHERE id=? LIMIT 1', [c.id]);
      if (existing && existing.tenant_id !== req.tenantId) return res.status(404).json({ error: 'Consultation not found' });
    }
    await conn.beginTransaction();
    transactionStarted = true;
    await conn.query(
      `INSERT INTO consultations
         (id, tenant_id, therapist_id, client_name, client_email, client_phone,
          session_date, session_type, slot_id, timezone, status, notes, meeting_link,
          amount, currency, session_duration_minutes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         therapist_id=VALUES(therapist_id), client_name=VALUES(client_name),
         client_email=VALUES(client_email), client_phone=VALUES(client_phone),
         status=VALUES(status), notes=VALUES(notes), meeting_link=VALUES(meeting_link),
         session_date=VALUES(session_date), session_type=VALUES(session_type),
         slot_id=VALUES(slot_id), timezone=VALUES(timezone), amount=VALUES(amount),
         currency=VALUES(currency), session_duration_minutes=VALUES(session_duration_minutes),
         updated_at=CURRENT_TIMESTAMP`,
      [
        id, req.tenantId, therapistId, clientName, clientEmail || null, clientPhone || null,
        sessionDate, sessionType, c.slotId || c.slot_id || null, c.timezone || 'Africa/Cairo',
        status, String(c.notes || '').slice(0, 5000), c.meetingLink || c.meeting_link || null,
        Number(c.amount) || 0, ['EGP', 'SAR', 'USD'].includes(c.currency) ? c.currency : 'EGP',
        Number(c.sessionDurationMinutes || c.session_duration_minutes) || null,
        String(c.createdAt || c.created_at || new Date().toISOString()).slice(0, 19).replace('T', ' '),
      ]
    );
    let leadId = null;
    if (!existing && (clientEmail || clientPhone)) {
      const normalizedPhone = clientPhone.replace(/\D/g, '');
      const [[knownSubscriber]] = await conn.query(
        `SELECT id FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL
          AND ((? <> '' AND RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)=RIGHT(?,10))
            OR (? <> '' AND LOWER(TRIM(email))=?)) LIMIT 1 FOR UPDATE`,
        [req.tenantId, normalizedPhone, normalizedPhone, clientEmail, clientEmail]
      );
      const [[knownLead]] = await conn.query(
        `SELECT id FROM leads WHERE tenant_id=? AND hidden=0
          AND ((? <> '' AND RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)=RIGHT(?,10))
            OR (? <> '' AND LOWER(TRIM(email))=?)) LIMIT 1 FOR UPDATE`,
        [req.tenantId, normalizedPhone, normalizedPhone, clientEmail, clientEmail]
      );
      if (!knownSubscriber && !knownLead) {
        leadId = uuidv4();
        const clientCode = await getNextClientCode(conn);
        const rep = await getNextSalesRep(req.tenantId, conn, { branch: 'OTHER' });
        await conn.query(
          `INSERT INTO leads
             (id, tenant_id, client_code, name, email, phone, source, status, interest_level,
              lead_type, branch, branch_id, assigned_sales_id, assigned_sales_name, notes, created_at, hidden)
           VALUES (?,?,?,?,?,?,?,'new','medium','consultation','OTHER',?,?,?,?,NOW(),0)`,
          [
            leadId, req.tenantId, clientCode, clientName, clientEmail || null, clientPhone || null,
            'consultation', branchIdForBranch('OTHER'), rep?.id || null, rep?.name || null,
            `Consultation booking with ${String(c.therapistName || '').slice(0, 200)}`,
          ]
        );
        await logLeadEvent(leadId, 'created', 'Consultation booking created lead', { consultationId: id }, req.tenantId, conn);
      }
    }
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, id, leadId });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn?.release();
  }
});
router.patch('/api/admin/consultations/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, notes, meeting_link } = req.body;
    const [r] = await pool.query(
      'UPDATE consultations SET status=?, notes=?, meeting_link=? WHERE id=? AND tenant_id=?',
      [status||'pending', notes||null, meeting_link||null, req.params.id, req.tenantId]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Consultation not found' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/consultations/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM consultations WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Consultation not found' });
    res.json({ ok: true });
  }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Financial Reconciliation — enrollments without matching payment ────────────
// POST /api/admin/backfill-payments — one-time: sync paymentHistory from crm_json → payments table
// Idempotent: uses INSERT IGNORE on the payment id so re-runs are safe.
module.exports = router;
