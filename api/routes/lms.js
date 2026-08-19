'use strict';
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool, cacheInvalidate } = require('../lib/db');
const { tryJson, validate } = require('../lib/helpers');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const { completeCourse, completeCourses } = require('../lib/courseCompletion');
const { reissueCertificate, revokeCertificate } = require('../lib/certificateLifecycle');
const { resolveLectureAccess } = require('../lib/learningAccess');
const { resolveSubscriberId, resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { createMediaTicket, mediaKind, playableRedirect, verifyMediaTicket } = require('../lib/mediaAccess');
const { streamTenantMedia } = require('../lib/uploadSafety');
const {
  addCohortMember,
  listCohortMembers,
  listCohorts,
  removeCohortMember,
  saveCohort,
} = require('../lib/learningCohorts');
const {
  listLearningPrerequisites,
  replaceLearningPrerequisites,
} = require('../lib/learningPrerequisites');
const outbox = require('../lib/outbox');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { bulkOperationLimiter, publicLimiter } = require('../middleware/rateLimits');

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function validHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(String(value)).protocol); } catch { return false; }
}
const LIVE_PLATFORMS = new Set(['zoom', 'google_meet', 'youtube', 'other']);
const LIVE_STATUSES = new Set(['scheduled', 'live', 'ended', 'cancelled']);
const LIVE_TRANSITIONS = {
  scheduled: new Set(['live', 'cancelled']),
  live: new Set(['ended', 'cancelled']),
  ended: new Set(),
  cancelled: new Set(),
};

function validateLiveSessionPatch(body, currentStatus = null) {
  const patch = {};
  for (const key of ['title','platform','meeting_url','meeting_id','meeting_pass','starts_at','duration_min','status','recording_url','notes']) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (!Object.keys(patch).length) {
    const error = new Error('Nothing to update'); error.statusCode = 400; throw error;
  }
  if (patch.title !== undefined && (!String(patch.title).trim() || String(patch.title).length > 255)) {
    const error = new Error('title must contain 1-255 characters'); error.statusCode = 400; throw error;
  }
  if (patch.platform !== undefined) {
    patch.platform = String(patch.platform).toLowerCase().replace('-', '_');
    if (!LIVE_PLATFORMS.has(patch.platform)) {
      const error = new Error('Invalid live session platform'); error.statusCode = 400; throw error;
    }
  }
  for (const key of ['meeting_url', 'recording_url']) {
    if (patch[key] !== undefined && patch[key] !== null && patch[key] !== '' && !validHttpUrl(patch[key])) {
      const error = new Error(`${key} must be a valid HTTP(S) URL`); error.statusCode = 400; throw error;
    }
  }
  if (patch.starts_at !== undefined && Number.isNaN(Date.parse(patch.starts_at))) {
    const error = new Error('starts_at must be a valid date'); error.statusCode = 400; throw error;
  }
  if (patch.duration_min !== undefined) {
    patch.duration_min = Number(patch.duration_min);
    if (!Number.isInteger(patch.duration_min) || patch.duration_min < 5 || patch.duration_min > 1440) {
      const error = new Error('duration_min must be an integer from 5 to 1440'); error.statusCode = 400; throw error;
    }
  }
  if (patch.status !== undefined) {
    patch.status = String(patch.status).toLowerCase();
    if (!LIVE_STATUSES.has(patch.status)
      || (currentStatus && patch.status !== currentStatus && !LIVE_TRANSITIONS[currentStatus]?.has(patch.status))) {
      const error = new Error('Invalid live session status transition'); error.statusCode = 409; throw error;
    }
  }
  if (patch.meeting_id !== undefined) patch.meeting_id = String(patch.meeting_id || '').slice(0, 200) || null;
  if (patch.meeting_pass !== undefined) patch.meeting_pass = String(patch.meeting_pass || '').slice(0, 100) || null;
  if (patch.notes !== undefined) patch.notes = String(patch.notes || '').slice(0, 10000) || null;
  return patch;
}

async function requireAssignedAnalyticsCourse(req, res, next) {
  try {
    const [[course]] = await pool.query(
      'SELECT id,instructor_id FROM courses WHERE tenant_id=? AND id=? AND deleted_at IS NULL LIMIT 1',
      [req.tenantId, req.params.courseId]
    );
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const role = String(req.staffRecord?.role || '').toLowerCase();
    if (['instructor', 'trainer'].includes(role) && String(course.instructor_id || '') !== String(req.staffRecord.id)) {
      return res.status(403).json({ error: 'Instructor analytics are limited to assigned courses' });
    }
    req.analyticsCourse = course;
    next();
  } catch {
    res.status(500).json({ error: 'Unable to authorize course analytics' });
  }
}

router.get('/api/admin/lms/prerequisites', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
  try {
    res.json({ rules: await listLearningPrerequisites(req.tenantId) });
  } catch {
    res.status(500).json({ error: 'Unable to load learning prerequisites' });
  }
});

router.put('/api/admin/lms/prerequisites', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const rules = await replaceLearningPrerequisites({
      tenantId: req.tenantId,
      subjectType: req.body?.subjectType,
      subjectId: req.body?.subjectId,
      rules: req.body?.rules,
      actor: req.user?.email || 'admin',
    }, conn);
    await conn.commit();
    res.json({ ok: true, rules });
  } catch (error) {
    await conn.rollback().catch(() => {});
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to save learning prerequisites' });
  } finally {
    conn.release();
  }
});

router.get('/api/admin/lms/cohorts', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
  try {
    res.json(await listCohorts(req.tenantId, req.query.course_id || null));
  } catch {
    res.status(500).json({ error: 'Unable to load cohorts' });
  }
});

router.post('/api/admin/lms/cohorts', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = await saveCohort({
      ...req.body,
      tenantId: req.tenantId,
      actor: req.staffRecord?.id || req.user?.email,
    }, conn);
    await conn.commit();
    res.status(req.body?.id ? 200 : 201).json({ ok: true, id });
  } catch (error) {
    await conn.rollback().catch(() => {});
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to save cohort' });
  } finally {
    conn.release();
  }
});

router.get('/api/admin/lms/cohorts/:id/members', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
  try {
    res.json(await listCohortMembers(req.tenantId, req.params.id));
  } catch {
    res.status(500).json({ error: 'Unable to load cohort members' });
  }
});

router.post('/api/admin/lms/cohorts/:id/members', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await addCohortMember({
      tenantId: req.tenantId,
      cohortId: req.params.id,
      subscriberId: req.body?.subscriberId,
      actor: req.staffRecord?.id || req.user?.email,
    }, conn);
    await conn.commit();
    res.status(result.changed ? 201 : 200).json({ ok: true, ...result });
  } catch (error) {
    await conn.rollback().catch(() => {});
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to add cohort member' });
  } finally {
    conn.release();
  }
});

router.delete('/api/admin/lms/cohorts/:id/members/:subscriberId', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await removeCohortMember({
      tenantId: req.tenantId,
      cohortId: req.params.id,
      subscriberId: req.params.subscriberId,
      actor: req.staffRecord?.id || req.user?.email,
    }, conn);
    await conn.commit();
    res.json({ ok: true, ...result });
  } catch (error) {
    await conn.rollback().catch(() => {});
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to remove cohort member' });
  } finally {
    conn.release();
  }
});

router.get('/api/me/cohorts', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ch.id,ch.title,ch.course_id AS courseId,c.title AS courseTitle,
              ch.starts_at AS startsAt,ch.ends_at AS endsAt,ch.status
         FROM cohort_members cm
         JOIN subscribers s ON s.id=cm.subscriber_id AND s.tenant_id=cm.tenant_id
         JOIN course_cohorts ch ON ch.id=cm.cohort_id AND ch.tenant_id=cm.tenant_id
         JOIN courses c ON c.id=ch.course_id AND c.tenant_id=ch.tenant_id
        WHERE cm.tenant_id=? AND LOWER(TRIM(s.email))=? AND cm.status='active'
        ORDER BY ch.starts_at DESC`,
      [req.tenantId, String(req.user.email || '').toLowerCase().trim()]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Unable to load cohorts' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── FEATURE v23: Progress Tracking ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// Retired insecure v23 contract. The canonical PATCH route validates tenant,
// enrollment and payment entitlement before persisting progress/certification.
router.post('/api/me/progress', requireAuth, (_req, res) => res.status(410).json({ error: 'Use PATCH /api/me/progress' }));

// GET /api/me/progress?course_id=xxx — get all lecture completions for subscriber
router.get('/api/me/progress', requireAuth, async (req, res) => {
  try {
    const subscriberId = await resolveSubscriberId(req);
    if (!subscriberId) return res.json([]);
    const { course_id } = req.query;
    let sql = 'SELECT lecture_id, course_id, progress_pct, watch_seconds, completed_at FROM lecture_completions WHERE subscriber_id=? AND tenant_id=?';
    const params = [subscriberId, req.tenantId];
    if (course_id) { sql += ' AND course_id=?'; params.push(course_id); }
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/courses/:courseId/progress — admin: completion stats per lecture
router.get('/api/admin/courses/:courseId/progress', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), requireAssignedAnalyticsCourse, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT lc.lecture_id, l.title AS lecture_title,
             COUNT(lc.id) AS completions,
             ROUND(AVG(lc.progress_pct),1) AS avg_pct,
             ROUND(AVG(lc.watch_seconds),0) AS avg_watch_sec
      FROM lecture_completions lc
      LEFT JOIN course_lectures l ON l.id=lc.lecture_id
       WHERE lc.course_id=? AND lc.tenant_id=?
      GROUP BY lc.lecture_id
      ORDER BY completions DESC
    `, [req.params.courseId, req.tenantId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── FEATURE v23: Drip Content ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/me/lectures/:lectureId/access — check if subscriber can access this lecture
router.get('/api/me/lectures/:lectureId/access', requireAuth, async (req, res) => {
  try {
    // enrollments is the shared access authority for the API and both frontends.
    const subscriberId = await resolveSubscriberId(req);
    if (!subscriberId) return res.status(403).json({ accessible: false, reason: 'not_subscribed' });
    const access = await resolveLectureAccess({
      tenantId: req.tenantId, subscriberId, lectureId: req.params.lectureId,
    });
    if (!access.accessible) {
      if (access.reason === 'not_found') return res.status(404).json({ accessible: false, reason: access.reason });
      return res.json({
        accessible: false, reason: access.reason,
        allowed: access.allowed, position: access.position, unlocks_at: access.unlocksAt,
      });
    }
    const lecture = access.lecture;
    // Access granted → return the video URL (the public catalog withholds it for paid lectures).
    const kind = mediaKind(lecture.video_url);
    const ticket = createMediaTicket({
      tenantId: req.tenantId, subscriberId, lectureId: lecture.id,
    });
    res.json({
      accessible: true,
      video_url: `/api/media/lectures/${encodeURIComponent(lecture.id)}?ticket=${encodeURIComponent(ticket)}&kind=${kind}`,
      video_kind: kind,
      expires_in: 300,
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/media/lectures/:lectureId', publicLimiter, async (req, res) => {
  try {
    const ticket = verifyMediaTicket(req.query.ticket, req.params.lectureId);
    if (!ticket) return res.status(401).json({ error: 'Media ticket is invalid or expired' });
    const [[lecture]] = await pool.query(
      `SELECT cl.video_url FROM course_lectures cl
       JOIN courses c ON c.id=cl.course_id AND c.tenant_id=?
       JOIN enrollments e ON e.course_id=cl.course_id AND e.tenant_id=? AND e.subscriber_id=? AND e.status='active'
       WHERE cl.id=? AND cl.is_published=1 LIMIT 1`,
      [ticket.tenantId, ticket.tenantId, ticket.subscriberId, ticket.lectureId]
    );
    const target = playableRedirect(lecture?.video_url);
    if (!target) return res.status(404).json({ error: 'Media is unavailable' });
    if (target.startsWith('/uploads/videos/')) {
      if (await streamTenantMedia(req, res, target, ticket.tenantId)) return;
      return res.status(404).json({ error: 'Media is unavailable' });
    }
    res.set('Cache-Control', 'private, no-store');
    // NOT "no-referrer": a redirect response's own Referrer-Policy header
    // overrides the iframe's policy for that hop (per the HTTP-redirect fetch
    // algorithm), so this was stripping the referrer YouTube's embed player
    // needs to validate the embedding domain — it served "Error 153: Video
    // player configuration error" instead of the video for every gated
    // lecture. strict-origin-when-cross-origin still hides the specific
    // lecture URL, just not the bare origin.
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return res.redirect(302, target);
  } catch {
    return res.status(500).json({ error: 'Unable to resolve media' });
  }
});

// PATCH /api/admin/lectures/:lectureId/drip — set drip_unlock_days
router.patch('/api/admin/lectures/:lectureId/drip', requireAuth, requireAdmin, async (req, res) => {
  try {
    const days = Math.max(0, Number(req.body.drip_unlock_days) || 0);
    const [result] = await pool.query(
      `UPDATE course_lectures cl JOIN courses c ON c.id=cl.course_id
       SET cl.drip_unlock_days=? WHERE cl.id=? AND c.tenant_id=?`,
      [days, req.params.lectureId, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Lecture not found' });
    // drip_unlock_days is part of the GET /api/lectures payload, which is cached
    // for five minutes — without this the new unlock schedule did not reach the
    // customer's LMS until the cache expired.
    cacheInvalidate('courses', 'lectures');
    res.json({ ok: true, drip_unlock_days: days });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── FEATURE v23: Live Sessions (Zoom / Google Meet) ───────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/live-sessions?course_id=
router.get('/api/admin/live-sessions', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
  try {
    const { course_id } = req.query;
    let sql = `SELECT ls.*, c.title AS course_title FROM live_sessions ls LEFT JOIN courses c ON c.id=ls.course_id AND c.tenant_id=ls.tenant_id WHERE ls.tenant_id=?`;
    const params = [req.tenantId];
    if (course_id) { sql += ' AND ls.course_id=?'; params.push(course_id); }
    sql += ' ORDER BY ls.starts_at DESC LIMIT 200';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/live-sessions — create a live session
router.post('/api/admin/live-sessions', requireAuth, requireAdmin, async (req, res) => {
  let conn;
  try {
    const { course_id, title, platform, meeting_url, meeting_id, meeting_pass, starts_at, duration_min, notes } = req.body;
    const normalized = validateLiveSessionPatch({
      title, platform: platform || 'zoom', meeting_url, meeting_id, meeting_pass,
      starts_at, duration_min: duration_min ?? 60, notes,
    });
    if (!validHttpUrl(normalized.meeting_url) || !normalized.starts_at) return res.status(400).json({ error: 'Valid meeting_url and starts_at required' });
    conn = await pool.getConnection();
    await conn.beginTransaction();
    if (course_id) {
      const [[course]] = await conn.query('SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [course_id, req.tenantId]);
      if (!course) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Course not found' }); }
    }
    const id = uuidv4();
    await conn.query(
      `INSERT INTO live_sessions (id, tenant_id, course_id, title, platform, meeting_url, meeting_id, meeting_pass, starts_at, duration_min, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, course_id||null, normalized.title, normalized.platform,
       normalized.meeting_url, normalized.meeting_id, normalized.meeting_pass,
       normalized.starts_at, normalized.duration_min, normalized.notes, req.user?.email||'admin']
    );
    if (course_id) {
      const [enrolled] = await conn.query(
        `SELECT s.id,s.email,s.name,s.phone FROM enrollments e
          JOIN subscribers s ON s.id=e.subscriber_id AND s.tenant_id=e.tenant_id
         WHERE e.course_id=? AND e.tenant_id=? AND e.status='active'`, [course_id, req.tenantId]
      );
      const sessionDate = new Date(starts_at).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'full', timeStyle: 'short' });
      for (const student of enrolled) {
        if (student.email) await outbox.enqueue({
          channel: 'email', recipient: student.email, subject: `جلسة مباشرة جديدة — ${title || ''}`,
          payload: { html: `<div dir="rtl"><h2>تم جدولة جلسة مباشرة جديدة</h2><p>أهلاً ${escapeHtml(student.name)}،</p><p>الموعد: <strong>${escapeHtml(sessionDate)}</strong></p><p><a href="${escapeHtml(meeting_url)}">انضم للجلسة</a></p>${meeting_pass ? `<p>كلمة المرور: <strong>${escapeHtml(meeting_pass)}</strong></p>` : ''}</div>` },
          tenantId: req.tenantId, dedupeKey: `live-session:${req.tenantId}:${id}:email:${student.id}`, refType: 'live_session', refId: id,
        }, conn);
        if (student.phone) await outbox.enqueue({
          channel: 'whatsapp', recipient: student.phone,
          payload: { message: `جلسة مباشرة جديدة\nالموعد: ${sessionDate}\n${meeting_url}${meeting_pass ? `\nكلمة المرور: ${meeting_pass}` : ''}` },
          tenantId: req.tenantId, dedupeKey: `live-session:${req.tenantId}:${id}:whatsapp:${student.id}`, refType: 'live_session', refId: id,
        }, conn);
      }
    }
    const [[row]] = await conn.query(
      `SELECT id, course_id, title, platform, meeting_url, meeting_id, meeting_pass, starts_at,
              duration_min, status, recording_url, notes, created_by, created_at
       FROM live_sessions WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    await conn.commit(); conn.release(); conn = null;
    res.status(201).json(row);
  } catch (e) {
    if (conn) { await conn.rollback().catch(() => {}); conn.release(); }
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' });
  }
});

// PATCH /api/admin/live-sessions/:id — update status/recording
router.patch('/api/admin/live-sessions/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[current]] = await pool.query(
      'SELECT status FROM live_sessions WHERE id=? AND tenant_id=? LIMIT 1',
      [req.params.id, req.tenantId]
    );
    if (!current) return res.status(404).json({ error: 'Live session not found' });
    const patch = validateLiveSessionPatch(req.body || {}, String(current.status).toLowerCase());
    const sets = Object.keys(patch).map(key => `${key}=?`);
    const vals = Object.values(patch);
    vals.push(req.params.id, req.tenantId);
    const [updated] = await pool.query(`UPDATE live_sessions SET ${sets.join(',')} WHERE id=? AND tenant_id=?`, vals);
    if (!updated.affectedRows) return res.status(404).json({ error: 'Live session not found' });
    const [[row]] = await pool.query(
      `SELECT id, course_id, title, platform, meeting_url, meeting_id, meeting_pass, starts_at,
              duration_min, status, recording_url, notes, created_by, created_at
       FROM live_sessions WHERE id=? AND tenant_id=?`, [req.params.id, req.tenantId]
    );
    res.json(row);
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' }); }
});

// GET /api/me/live-sessions — get upcoming live sessions for enrolled courses
router.get('/api/me/live-sessions', requireAuth, async (req, res) => {
  try {
    const subscriberId = await resolveSubscriberId(req);
    if (!subscriberId) return res.json([]);
    const [rows] = await pool.query(`
      SELECT ls.id, ls.course_id, ls.title, ls.platform, ls.meeting_url,
             ls.meeting_id, ls.meeting_pass, ls.starts_at, ls.duration_min,
             ls.status, ls.recording_url, ls.notes, c.title AS course_title
      FROM live_sessions ls
       JOIN courses c ON c.id=ls.course_id AND c.tenant_id=ls.tenant_id
       JOIN enrollments e ON e.course_id=ls.course_id AND e.subscriber_id=? AND e.tenant_id=ls.tenant_id
       WHERE ls.tenant_id=? AND e.status='active' AND ls.starts_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
        AND ls.status IN ('scheduled','live')
      ORDER BY ls.starts_at ASC
    `, [subscriberId, req.tenantId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── FEATURE v23: Email Sequences ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/email-sequences
router.get('/api/admin/email-sequences', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [seqs] = await pool.query(
      'SELECT id, name, trigger_event, is_active, created_at FROM email_sequences WHERE tenant_id=? ORDER BY created_at DESC', [req.tenantId]
    );
    // Batch-load all steps in 1 query instead of N
    const seqIds = seqs.map(s => s.id);
    const allSteps = seqIds.length
      ? (await pool.query('SELECT id, sequence_id, step_order, delay_hours, subject FROM email_sequence_steps WHERE tenant_id=? AND sequence_id IN (?) ORDER BY step_order', [req.tenantId, seqIds]))[0]
      : [];
    const stepsMap = {};
    for (const st of allSteps) { (stepsMap[st.sequence_id] = stepsMap[st.sequence_id] || []).push(st); }
    for (const s of seqs) s.steps = stepsMap[s.id] || [];
    res.json(seqs);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/email-sequences — create sequence with steps
router.post('/api/admin/email-sequences', requireAuth, requireAdmin, async (req, res) => {
  let conn;
  try {
    const { name, trigger_event, is_active, steps } = req.body;
    if (!name || !trigger_event) return res.status(400).json({ error: 'name and trigger_event required' });
    const seqId = uuidv4();
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query(
      'INSERT INTO email_sequences (id, tenant_id, name, trigger_event, is_active) VALUES (?,?,?,?,?)',
      [seqId, req.tenantId, name, trigger_event, is_active !== false ? 1 : 0]
    );
    if (Array.isArray(steps) && steps.length > 0) {
      // Batch INSERT steps in 1 query instead of N
      const stepRows = steps.slice(0, 100).map(() => '(UUID(),?,?,?,?,?,?)');
      const stepParams = steps.slice(0, 100).flatMap((st, i) => [req.tenantId, seqId, i + 1, Number(st.delay_hours) || 0, st.subject || '', st.body_html || '']);
      await conn.query(
        `INSERT INTO email_sequence_steps (id, tenant_id, sequence_id, step_order, delay_hours, subject, body_html) VALUES ${stepRows.join(',')}`,
        stepParams
      );
    }
    const [[seq]] = await conn.query(
      'SELECT id, name, trigger_event, is_active, created_at FROM email_sequences WHERE id=? AND tenant_id=?', [seqId, req.tenantId]
    );
    const [stepsOut] = await conn.query(
      'SELECT id, sequence_id, step_order, delay_hours, subject, body_html FROM email_sequence_steps WHERE sequence_id=? AND tenant_id=? ORDER BY step_order',
      [seqId, req.tenantId]
    );
    await conn.commit(); conn.release(); conn = null;
    res.json({ ...seq, steps: stepsOut });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/email-sequences/:id
router.delete('/api/admin/email-sequences/:id', requireAuth, requireAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[sequence]] = await conn.query('SELECT id FROM email_sequences WHERE id=? AND tenant_id=? FOR UPDATE', [req.params.id, req.tenantId]);
    if (!sequence) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Sequence not found' }); }
    await conn.query('DELETE FROM email_sequence_steps WHERE sequence_id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    await conn.query('DELETE FROM email_sequences WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── FEATURE v23: Employee Self-Service (leaves, payslip, commissions) ─────────
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/staff/me/leaves — employee submits own leave request
// GET /api/staff/me/payslip?month=&year= — employee views own payslip
// GET /api/staff/me/commissions?month=&year= — employee views own commissions
// ── Wire email sequences into registration + enrollment triggers ───────────────
// (Done via monkey-patch on pool post-insert — safer to call from the register handler above
//  but here we expose a helper endpoint that can be called retroactively)
router.post('/api/admin/email-sequences/trigger-test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { trigger_event, email, name } = req.body;
    if (!trigger_event || !email) return res.status(400).json({ error: 'trigger_event and email required' });
    const queued = await enqueueEmailSequence({ tenantId: req.tenantId, triggerEvent: trigger_event, recipientEmail: email, recipientName: name || '' });
    res.json({ ok: true, queued, message: `Enqueued ${trigger_event} sequence for ${email}` });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Staff Work Schedule (Weekly Shifts) ──────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/staff/:staffId/schedule — get weekly schedule
router.get('/api/admin/staff/:staffId/schedule', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, staff_id, day_of_week, start_time, end_time, grace_minutes, is_off_day FROM work_schedules WHERE staff_id = ? AND tenant_id=? ORDER BY day_of_week ASC',
      [req.params.staffId, req.tenantId]
    );
    // Ensure all 7 days present (fill missing with defaults)
    const days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    const schedule = Array.from({ length: 7 }, (_, i) => {
      const existing = rows.find(r => r.day_of_week === i);
      return existing || { staff_id: req.params.staffId, day_of_week: i, day_name: days[i], start_time: '09:00:00', end_time: '17:00:00', grace_minutes: 15, is_off_day: i === 5 || i === 6 ? 1 : 0 };
    });
    res.json(schedule);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/staff/:staffId/schedule — upsert full weekly schedule (array of 7 days)
router.put('/api/admin/staff/:staffId/schedule', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { schedule } = req.body; // array of { day_of_week, start_time, end_time, grace_minutes, is_off_day }
    if (!Array.isArray(schedule)) return res.status(400).json({ error: 'schedule must be an array' });
    if (schedule.length > 7 || schedule.some(day => !Number.isInteger(Number(day.day_of_week)) || Number(day.day_of_week) < 0 || Number(day.day_of_week) > 6)) return res.status(400).json({ error: 'Invalid weekly schedule' });
    const [[staff]] = await pool.query('SELECT id FROM staff WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1', [req.params.staffId, req.tenantId]);
    if (!staff) return res.status(404).json({ error: 'Staff not found' });
    if (schedule.length > 0) {
      // Batch UPSERT entire weekly schedule in 1 query instead of N
      const schedRows = schedule.map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?)');
      const schedParams = schedule.flatMap(day => [
        req.tenantId, req.params.staffId, Number(day.day_of_week), day.start_time || '09:00:00',
        day.end_time || '17:00:00', day.grace_minutes ?? 15, day.is_off_day ? 1 : 0,
      ]);
      await pool.query(
        `INSERT INTO work_schedules (id, tenant_id, staff_id, day_of_week, start_time, end_time, grace_minutes, is_off_day)
         VALUES ${schedRows.join(',')}
         ON DUPLICATE KEY UPDATE
           start_time = VALUES(start_time),
           end_time = VALUES(end_time),
           grace_minutes = VALUES(grace_minutes),
           is_off_day = VALUES(is_off_day)`,
        schedParams
      );
    }
    res.json({ ok: true, updated: schedule.length });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/schedules — all staff schedules overview (for weekly roster view)
router.get('/api/admin/schedules', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ws.*, u.name AS staff_name, u.email AS staff_email, u.role AS staff_role
      FROM work_schedules ws
       JOIN staff st ON st.id=ws.staff_id AND st.tenant_id=ws.tenant_id
       LEFT JOIN users u ON u.id = ws.staff_id
       WHERE ws.tenant_id=? AND st.is_active = 1
      ORDER BY u.name ASC, ws.day_of_week ASC
    `, [req.tenantId]);
    // Group by staff
    const byStaff = {};
    for (const r of rows) {
      if (!byStaff[r.staff_id]) byStaff[r.staff_id] = { staff_id: r.staff_id, name: r.staff_name, email: r.staff_email, role: r.staff_role, days: [] };
      byStaff[r.staff_id].days.push(r);
    }
    res.json(Object.values(byStaff));
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/attendance?staff_id=&from=&to=&status= — attendance log
router.get('/api/admin/attendance', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const { staff_id, from, to, status } = req.query;
    const fromDate = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const toDate   = to   || new Date().toISOString().slice(0, 10);
    let sql = `
      SELECT al.*, u.name AS staff_name, u.email AS staff_email
      FROM attendance_logs al
      JOIN users u ON u.id = al.staff_id
      JOIN staff st ON st.id=al.staff_id AND st.tenant_id=al.tenant_id
      WHERE al.tenant_id=? AND al.date BETWEEN ? AND ?
    `;
    const params = [req.tenantId, fromDate, toDate];
    if (staff_id) { sql += ' AND al.staff_id = ?'; params.push(staff_id); }
    if (status)   { sql += ' AND al.status = ?';   params.push(status); }
    sql += ' ORDER BY al.date DESC, u.name ASC LIMIT 2000';
    const [rows] = await pool.query(sql, params);

    // Summary stats
    const summary = {
      present: rows.filter(r => r.status === 'PRESENT').length,
      absent: rows.filter(r => r.status === 'ABSENT').length,
      late: rows.filter(r => r.status === 'LATE').length,
      leave: rows.filter(r => r.status === 'LEAVE').length,
      total: rows.length
    };
    res.json({ logs: rows, summary, period: { from: fromDate, to: toDate } });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/attendance — log a single attendance record
router.post('/api/admin/attendance', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { staff_id, date, check_in, check_out, status, notes } = req.body;
    if (!staff_id || !date) return res.status(400).json({ error: 'staff_id and date required' });
    const [[staff]] = await pool.query('SELECT id FROM staff WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1', [staff_id, req.tenantId]);
    if (!staff) return res.status(404).json({ error: 'Staff not found' });
    const totalHours = (check_in && check_out)
      ? parseFloat(((new Date(`2000-01-01T${check_out}`) - new Date(`2000-01-01T${check_in}`)) / 3600000).toFixed(2))
      : null;
    await pool.query(
      `INSERT INTO attendance_logs (id, tenant_id, staff_id, date, check_in, check_out, total_hours, status, notes, source)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL_ENTRY')
       ON DUPLICATE KEY UPDATE check_in=VALUES(check_in), check_out=VALUES(check_out),
         total_hours=VALUES(total_hours), status=VALUES(status), notes=VALUES(notes)`,
      [req.tenantId, staff_id, date, check_in || null, check_out || null, totalHours, status || 'PRESENT', notes || null]
    );
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/me/schedule — employee views own schedule
// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Performance Appraisals ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


// GET /api/admin/appraisals?staff_id=&year=&month=&status=
router.get('/api/admin/appraisals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { staff_id, year, month, status } = req.query;
    let sql = `
      SELECT pa.*, u.name AS staff_name, u.email AS staff_email, u.role AS staff_role
      FROM performance_appraisals pa
      LEFT JOIN users u ON u.id = pa.staff_id
      WHERE pa.tenant_id=?
    `;
    const params = [req.tenantId];
    if (staff_id) { sql += ' AND pa.staff_id = ?'; params.push(staff_id); }
    if (year)     { sql += ' AND pa.period_year = ?'; params.push(parseInt(year)); }
    if (month)    { sql += ' AND pa.period_month = ?'; params.push(parseInt(month)); }
    if (status)   { sql += ' AND pa.status = ?'; params.push(status); }
    sql += ' ORDER BY pa.period_year DESC, pa.period_month DESC, pa.created_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows.map(r => ({ ...r, kpi_scores: tryJson(r.kpi_scores, []) })));
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/appraisals — create appraisal
router.post('/api/admin/appraisals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { staff_id, period_month, period_year, kpi_scores, notes, status } = req.body;
    if (!staff_id || !period_month || !period_year) return res.status(400).json({ error: 'staff_id, period_month, period_year required' });
    const [[staff]] = await pool.query('SELECT id FROM staff WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1', [staff_id, req.tenantId]);
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    const kpis = Array.isArray(kpi_scores) ? kpi_scores : [];
    // Calculate overall score: average of kpi score values
    let overall = null;
    if (kpis.length) {
      const scoreSum = kpis.reduce((s, k) => s + (parseFloat(k.score) || 0), 0);
      overall = parseFloat((scoreSum / kpis.length).toFixed(2));
    }
    const grade = overall === null ? null
      : overall >= 90 ? 'A' : overall >= 75 ? 'B' : overall >= 60 ? 'C' : 'D';

    const id = uuidv4();
    await pool.query(
      `INSERT INTO performance_appraisals (id, tenant_id, staff_id, reviewer_email, period_month, period_year, kpi_scores, overall_score, grade, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.tenantId, staff_id, req.user.email, parseInt(period_month), parseInt(period_year),
       JSON.stringify(kpis), overall, grade, notes || null, status || 'draft']
    );
    res.status(201).json({ id, overall_score: overall, grade, message: 'Appraisal created' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/appraisals/:id — update appraisal
router.patch('/api/admin/appraisals/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { kpi_scores, notes, status, overall_score } = req.body;
    const fields = []; const params = [];
    if (kpi_scores !== undefined) {
      const kpis = Array.isArray(kpi_scores) ? kpi_scores : [];
      fields.push('kpi_scores = ?'); params.push(JSON.stringify(kpis));
      // Recalculate grade
      if (kpis.length) {
        const scoreSum = kpis.reduce((s, k) => s + (parseFloat(k.score) || 0), 0);
        const overall  = parseFloat((scoreSum / kpis.length).toFixed(2));
        const grade    = overall >= 90 ? 'A' : overall >= 75 ? 'B' : overall >= 60 ? 'C' : 'D';
        fields.push('overall_score = ?', 'grade = ?');
        params.push(overall, grade);
      }
    }
    if (notes !== undefined)         { fields.push('notes = ?');         params.push(notes); }
    if (status !== undefined)        { fields.push('status = ?');        params.push(status); }
    if (overall_score !== undefined) { fields.push('overall_score = ?'); params.push(parseFloat(overall_score)); }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id, req.tenantId);
    const [result] = await pool.query(`UPDATE performance_appraisals SET ${fields.join(', ')} WHERE id = ? AND tenant_id=?`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Appraisal not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/appraisals/:id
router.delete('/api/admin/appraisals/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM performance_appraisals WHERE id = ? AND tenant_id=?', [req.params.id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Appraisal not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/me/appraisals — employee views own appraisals
// GET /api/admin/appraisals/summary?year= — team performance overview
router.get('/api/admin/appraisals/summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const [rows] = await pool.query(`
      SELECT
        u.name AS staff_name, u.role AS staff_role,
        COUNT(*) AS appraisal_count,
        AVG(pa.overall_score) AS avg_score,
        MAX(pa.overall_score) AS best_score,
        MIN(pa.overall_score) AS lowest_score,
        SUM(CASE WHEN pa.grade='A' THEN 1 ELSE 0 END) AS grade_a,
        SUM(CASE WHEN pa.grade='B' THEN 1 ELSE 0 END) AS grade_b,
        SUM(CASE WHEN pa.grade='C' THEN 1 ELSE 0 END) AS grade_c,
        SUM(CASE WHEN pa.grade='D' THEN 1 ELSE 0 END) AS grade_d
      FROM performance_appraisals pa
      LEFT JOIN users u ON u.id = pa.staff_id
       WHERE pa.period_year = ? AND pa.status = 'approved' AND pa.tenant_id=?
      GROUP BY pa.staff_id, u.name, u.role
      ORDER BY avg_score DESC
    `, [year, req.tenantId]);
    res.json({ year, team: rows.map(r => ({ ...r, avg_score: parseFloat(r.avg_score || 0).toFixed(1) })) });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Course Waitlist ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


// GET /api/admin/courses/:courseId/waitlist — list waitlist entries
router.get('/api/admin/courses/:courseId/waitlist', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  try {
    const { courseId } = req.params;
    const [rows] = await pool.query(
      `SELECT wl.*, s.client_code
       FROM course_waitlist wl
       LEFT JOIN subscribers s ON s.id = wl.subscriber_id AND s.tenant_id=wl.tenant_id
       WHERE wl.course_id = ? AND wl.tenant_id=?
       ORDER BY wl.position ASC, wl.created_at ASC`,
      [courseId, req.tenantId]
    );
    const [[{ enrolled }]] = await pool.query(
      "SELECT COUNT(*) AS enrolled FROM enrollments WHERE course_id = ? AND tenant_id=? AND status='active'",
      [courseId, req.tenantId]
    );
    const [[course]] = await pool.query('SELECT title, max_students FROM courses WHERE id = ? AND tenant_id=? AND deleted_at IS NULL', [courseId, req.tenantId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    res.json({
      waitlist: rows,
      enrolled: Number(enrolled),
      max_students: course?.max_students || null,
      available_spots: course?.max_students ? Math.max(0, course.max_students - Number(enrolled)) : null
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/courses/:courseId/waitlist — add someone to waitlist
router.post('/api/admin/courses/:courseId/waitlist', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  let conn;
  try {
    const { courseId } = req.params;
    const { subscriber_id, name, email, phone } = req.body;
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[course]] = await conn.query('SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL FOR UPDATE', [courseId, req.tenantId]);
    if (!course) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Course not found' }); }
    if (subscriber_id) {
      const [[subscriber]] = await conn.query('SELECT id FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL', [subscriber_id, req.tenantId]);
      if (!subscriber) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Subscriber not found' }); }
    }
    const [[{ maxPos }]] = await conn.query(
      'SELECT COALESCE(MAX(position), 0) AS maxPos FROM course_waitlist WHERE course_id = ? AND tenant_id=? FOR UPDATE', [courseId, req.tenantId]
    );
    const id = uuidv4();
    await conn.query(
      `INSERT INTO course_waitlist (id, tenant_id, course_id, subscriber_id, name, email, phone, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.tenantId, courseId, subscriber_id || null, name || null, email || null, phone || null, Number(maxPos) + 1]
    );
    await conn.commit(); conn.release(); conn = null;
    res.status(201).json({ id, position: Number(maxPos) + 1 });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/me/waitlist — student joins waitlist for a course
router.post('/api/me/waitlist', requireAuth, async (req, res) => {
  let conn;
  try {
    const { course_id } = req.body;
    if (!course_id) return res.status(400).json({ error: 'course_id required' });
    conn = await pool.getConnection(); await conn.beginTransaction();
    // Resolve by account link first. A WhatsApp-only client has no email, and
    // req.user.email.toLowerCase() threw on null here before it even queried.
    const identified = await resolveSubscriberRow(req, ['id'], conn);
    const [[sub]] = identified
      ? await conn.query('SELECT id, name, email, phone FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [identified.id, req.tenantId])
      : [[null]];
    if (!sub) { await conn.rollback(); conn.release(); conn = null; return res.status(403).json({ error: 'Subscriber account required' }); }
    const [[course]] = await conn.query('SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL FOR UPDATE', [course_id, req.tenantId]);
    if (!course) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Course not found' }); }

    // Check not already on waitlist
    const [[existing]] = await conn.query(
      "SELECT id FROM course_waitlist WHERE tenant_id=? AND course_id = ? AND subscriber_id = ? AND status IN ('waiting','notified')",
      [req.tenantId, course_id, sub.id]
    );
    if (existing) { await conn.rollback(); conn.release(); conn = null; return res.status(409).json({ error: 'Already on waitlist' }); }

    const [[{ maxPos }]] = await conn.query(
      'SELECT COALESCE(MAX(position), 0) AS maxPos FROM course_waitlist WHERE course_id = ? AND tenant_id=? FOR UPDATE', [course_id, req.tenantId]
    );
    const id = uuidv4();
    const pos = Number(maxPos) + 1;
    await conn.query(
      `INSERT INTO course_waitlist (id, tenant_id, course_id, subscriber_id, name, email, phone, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.tenantId, course_id, sub.id, sub.name, sub.email, sub.phone, pos]
    );
    await conn.commit(); conn.release(); conn = null;
    res.status(201).json({ id, position: pos, message: 'Added to waitlist' });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/courses/:courseId/waitlist/:id — update entry status / notify
router.patch('/api/admin/courses/:courseId/waitlist/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  let conn;
  try {
    const { status, notify } = req.body;
    if (status && !['waiting', 'notified', 'enrolled', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[entry]] = await conn.query(
      `SELECT wl.id,wl.course_id,wl.subscriber_id,wl.name,wl.email,wl.phone,wl.position,wl.status,c.title
         FROM course_waitlist wl JOIN courses c ON c.id=wl.course_id AND c.tenant_id=wl.tenant_id
        WHERE wl.id=? AND wl.course_id=? AND wl.tenant_id=? FOR UPDATE`,
      [req.params.id, req.params.courseId, req.tenantId]
    );
    if (!entry) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Waitlist entry not found' }); }
    if (status) {
      await conn.query(
        'UPDATE course_waitlist SET status = ?, notified_at = CASE WHEN ? = ? THEN NOW() ELSE notified_at END WHERE id = ? AND course_id = ? AND tenant_id=?',
        [status, status, 'notified', req.params.id, req.params.courseId, req.tenantId]
      );
    }
    if (notify && entry.email) {
      await outbox.enqueue({
        channel: 'email', recipient: entry.email, subject: `متاح مقعد في كورس ${entry.title || ''}`,
        payload: { html: `<div dir="rtl"><p>مرحباً ${escapeHtml(entry.name)}،</p><p>توفر مقعد في كورس <strong>${escapeHtml(entry.title)}</strong>.</p><p>يرجى التواصل معنا لتأكيد التسجيل.</p></div>` },
        tenantId: req.tenantId, dedupeKey: `waitlist-seat:${req.tenantId}:${entry.id}`, refType: 'course_waitlist', refId: entry.id,
      }, conn);
      await conn.query('UPDATE course_waitlist SET status=?,notified_at=NOW() WHERE id=? AND tenant_id=?', ['notified', entry.id, req.tenantId]);
    }
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/courses/:courseId/capacity — set max_students
router.patch('/api/admin/courses/:courseId/capacity', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { max_students } = req.body;
    const capacity = max_students === null || max_students === '' ? null : Number(max_students);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)) return res.status(400).json({ error: 'Invalid capacity' });
    const [updated] = await pool.query('UPDATE courses SET max_students = ? WHERE id = ? AND tenant_id=? AND deleted_at IS NULL',
      [capacity, req.params.courseId, req.tenantId]);
    if (!updated.affectedRows) return res.status(404).json({ error: 'Course not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Auto Course Completion + Certificate Generation ─────────────
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/admin/completions — admin marks a subscriber as completing a course
// Idempotent: if already completed, returns existing certificate. requireFullProgress
// is explicitly off here — this route's whole purpose is a manual staff override for
// students who finished offline/outside the tracked-progress flow (LMS-07 made
// completeCourse() strict by default; this is the deliberate, audited exception).
router.post('/api/admin/completions', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!reason || reason.length > 500) return res.status(400).json({ error: 'A manual completion reason (1-500 characters) is required' });
    const completionResult = await completeCourse({
      tenantId: req.tenantId, subscriberId: req.body?.subscriber_id, courseId: req.body?.course_id,
      actor: req.user?.email || req.staffRecord?.name || 'admin', requireFullProgress: false,
      reason,
    });
    res.status(completionResult.alreadyCompleted ? 200 : 201).json(completionResult);
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' }); }
});

// POST /api/admin/completions/bulk — bulk mark multiple subscribers as completed
router.post('/api/admin/completions/bulk', requireAuth, requireAdmin, requirePermission('manage_courses'), bulkOperationLimiter, async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!reason || reason.length > 500) return res.status(400).json({ error: 'A bulk completion reason (1-500 characters) is required' });
    const completionResults = await completeCourses({
      tenantId: req.tenantId, subscriberIds: req.body?.subscriber_ids, courseId: req.body?.course_id,
      actor: req.user?.email || 'admin', requireFullProgress: false,
      reason,
    });
    res.json({ results: completionResults, created: completionResults.filter(item => !item.alreadyCompleted).length, skipped: completionResults.filter(item => item.alreadyCompleted).length, total: completionResults.length });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' }); }
});

// GET /api/admin/completions?course_id=&subscriber_id= — list completions
router.post('/api/admin/completions/:id/revoke', requireAuth, requireAdmin, requirePermission('manage_courses'), async (req, res) => {
  try {
    res.json(await revokeCertificate({
      tenantId: req.tenantId, completionId: req.params.id,
      actor: req.user?.email || 'admin', reason: req.body?.reason,
    }));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to revoke certificate' });
  }
});

router.post('/api/admin/completions/:id/reissue', requireAuth, requireAdmin, requirePermission('manage_courses'), async (req, res) => {
  try {
    res.json(await reissueCertificate({
      tenantId: req.tenantId, completionId: req.params.id,
      actor: req.user?.email || 'admin', reason: req.body?.reason,
    }));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to reissue certificate' });
  }
});

router.get('/api/admin/completions/:id/events', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.* FROM certificate_lifecycle_events e
       JOIN course_completions cc ON cc.id=e.completion_id AND cc.tenant_id=e.tenant_id
       WHERE e.completion_id=? AND e.tenant_id=?
       ORDER BY e.created_at DESC,e.id DESC`,
      [req.params.id, req.tenantId]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Unable to load certificate history' });
  }
});

router.get('/api/admin/completions', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
  try {
    const { course_id, subscriber_id } = req.query;
    let sql = `
      SELECT cc.*, s.name AS subscriber_name, s.email AS subscriber_email, s.client_code,
             c.title AS course_title
      FROM course_completions cc
      JOIN subscribers s ON s.id=cc.subscriber_id AND s.tenant_id=cc.tenant_id
      JOIN courses c ON c.id=cc.course_id AND c.tenant_id=cc.tenant_id
      WHERE cc.tenant_id=?
    `;
    const params = [req.tenantId];
    if (course_id)     { sql += ' AND cc.course_id = ?';     params.push(course_id); }
    if (subscriber_id) { sql += ' AND cc.subscriber_id = ?'; params.push(subscriber_id); }
    sql += ' ORDER BY cc.completed_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    const clientBase = String(process.env.CLIENT_URL || 'https://mahadnafsy.com').replace(/\/$/, '');
    res.json(rows.map(r => ({ ...r, certificate_url: `${clientBase}/certificate/${encodeURIComponent(r.certificate_code)}` })));
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Referral Earnings Dashboard ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/referrals — admin view all referral codes + earnings
// (removed dead duplicate GET /api/admin/referrals — live in an earlier-mounted router)

// GET /api/admin/referrals/:code/subscribers — who registered with this code
router.get('/api/admin/referrals/:code/subscribers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.email, s.client_code, s.created_at
       FROM subscribers s
       WHERE s.referral_code = ? AND s.tenant_id = ?
       ORDER BY s.created_at DESC`,
      [req.params.code, req.tenantId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/referrals/:id/earnings — manually adjust referral earnings
router.patch('/api/admin/referrals/:id/earnings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { earnings, adjustment_note } = req.body;
    const [r] = await pool.query('UPDATE referral_codes SET earnings = ? WHERE id = ? AND tenant_id = ?', [parseFloat(earnings) || 0, req.params.id, req.tenantId]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Student Community / Forum ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


// GET /api/community/posts?course_id=&page=&limit=
// Public to authenticated clients — list posts (top-level only by default)
// (removed dead duplicate GET /api/community/posts — live in an earlier-mounted router)

// GET /api/community/posts/:id — single post with replies
router.get('/api/community/posts/:id', requireAuth, async (req, res) => {
  try {
    const [[post]] = await pool.query(
      `SELECT id, author_id, author_name, course_id, parent_id, title, body, upvotes, is_pinned, is_hidden, created_at, updated_at
       FROM forum_posts WHERE tenant_id=? AND id=? AND is_hidden=0`, [req.tenantId, req.params.id]
    );
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const [replies] = await pool.query(
      `SELECT id, author_id, author_name, course_id, parent_id, title, body, upvotes, is_pinned, is_hidden, created_at, updated_at
       FROM forum_posts WHERE tenant_id=? AND parent_id=? AND is_hidden=0 ORDER BY created_at ASC`,
      [req.tenantId, req.params.id]
    );
    res.json({ post, replies });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// NOTE: POST /api/community/posts (forum_posts) was here too but collided with
// community.js (which mounts first) and no frontend calls forum_posts — removed
// to end the route collision. The distinct /:id/upvote route stays below.

// POST /api/community/posts/:id/upvote — toggle upvote
router.post('/api/community/posts/:id/upvote', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const sub = await resolveSubscriberRow(req, ['id'], conn);
    if (!sub) return res.status(403).json({ error: 'Subscriber required' });
    await conn.beginTransaction();
    const [[post]] = await conn.query('SELECT id FROM forum_posts WHERE tenant_id=? AND id=? AND is_hidden=0 FOR UPDATE', [req.tenantId, req.params.id]);
    if (!post) {
      await conn.rollback();
      return res.status(404).json({ error: 'Post not found' });
    }

    const [[existing]] = await conn.query('SELECT 1 FROM forum_upvotes WHERE tenant_id=? AND post_id=? AND subscriber_id=?',
      [req.tenantId, req.params.id, sub.id]);

    if (existing) {
      await conn.query('DELETE FROM forum_upvotes WHERE tenant_id=? AND post_id=? AND subscriber_id=?', [req.tenantId, req.params.id, sub.id]);
      await conn.query('UPDATE forum_posts SET upvotes=GREATEST(0, upvotes-1) WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
      await conn.commit();
      res.json({ upvoted: false });
    } else {
      await conn.query('INSERT INTO forum_upvotes (tenant_id, post_id, subscriber_id) VALUES (?,?,?)', [req.tenantId, req.params.id, sub.id]);
      await conn.query('UPDATE forum_posts SET upvotes=upvotes+1 WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
      await conn.commit();
      res.json({ upvoted: true });
    }
  } catch (e) {
    await conn.rollback().catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// PATCH /api/admin/community/posts/:id — admin: pin/hide post
router.patch('/api/admin/community/posts/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const { is_pinned, is_hidden } = req.body;
    const fields = []; const params = [];
    if (is_pinned !== undefined) { fields.push('is_pinned = ?'); params.push(is_pinned ? 1 : 0); }
    if (is_hidden !== undefined) { fields.push('is_hidden = ?'); params.push(is_hidden ? 1 : 0); }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.tenantId, req.params.id);
    const [result] = await pool.query(`UPDATE forum_posts SET ${fields.join(', ')} WHERE tenant_id=? AND id=?`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Post not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/community/posts/:id — admin delete
// (removed dead duplicate DELETE /api/admin/community/posts/:id — live in an earlier-mounted router)

// GET /api/admin/community/posts?hidden=1 — admin: list all including hidden
// (removed dead duplicate GET /api/admin/community/posts — live in an earlier-mounted router)


module.exports = router;
