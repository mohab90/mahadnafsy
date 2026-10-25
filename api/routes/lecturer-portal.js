'use strict';

// «حساب محاضر» (25 Oct 2026): the lecturer's own portal. Everything here is scoped to the signed-in lecturer's staff id
// (lib/lecturerPortal.js): their lives, their consultation hours, their ratings, students, fees and notifications, and
// their part in the community.
//
//   GET    /api/staff/lecturer/overview                       the numbers at the top
//   GET    /api/staff/lecturer/lives                          their lives (with who came)
//   POST   /api/staff/lecturer/lives                          schedule one — the audience is told (lib/liveStreams.js)
//   PATCH  /api/staff/lecturer/lives/:id                      change one that has not started
//   DELETE /api/staff/lecturer/lives/:id                      cancel one that has not started
//   POST   /api/staff/lecturer/community-live                 a free live in the community, starting now
//   GET    /api/staff/lecturer/availability                   weekly hours + the days they are away
//   PUT    /api/staff/lecturer/availability/slots             set the weekly hours (consultations enabled only)
//   POST   /api/staff/lecturer/availability/blocked           close a day
//   DELETE /api/staff/lecturer/availability/blocked/:id       open it again
//   GET    /api/staff/lecturer/consultations                  their consultations
//   PATCH  /api/staff/lecturer/consultations/:id              confirm / complete / cancel / note one
//   GET    /api/staff/lecturer/reviews | students | earnings  ratings, students and attendance, fees and payslips
//   GET    /api/staff/lecturer/notifications, POST …/read     the bell
//   GET/PATCH /api/staff/lecturer/profile                     the public profile of their consultation page
//   POST   /api/staff/lecturer/community/posts …              post, comment and like in the community as a lecturer

const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');
const { pool, cacheInvalidate } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { LIVE_STREAM_COLS, mapLiveStream } = require('../lib/mappers');
const { announceLiveStream } = require('../lib/liveStreams');
const { createNotification } = require('../lib/notification');
const {
  earningsOf, myCourses, myRounds, overviewOf, requireLecturer, reviewsOf, studentsOf,
} = require('../lib/lecturerPortal');
const {
  blockDay, blockedDatesOf, normalizeSlots, replaceWeeklySlots, unblockDay,
} = require('../lib/therapistAvailability');

const guard = [requireAuth, requireAdminOrStaff, requirePermission('use_lecturer_portal'), requireLecturer(pool)];
const PLATFORMS = new Set(['ZOOM', 'YOUTUBE', 'MEET', 'OTHER']);
const VISIBILITIES = new Set(['ALL_SUBSCRIBERS', 'COURSE_SUBSCRIBERS', 'COMMUNITY_ALL', 'COMMUNITY_AND_SUBSCRIBERS']);

const fail = (res, error, where) => {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) logger.error(`[lecturer/${where}]`, error.message);
  res.status(statusCode).json({ error: statusCode < 500 ? error.message : 'Internal server error', ...(error.code ? { code: error.code } : {}) });
};
const bad = (error, code, statusCode = 400) => Object.assign(new Error(error), { statusCode, code });
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const httpUrl = value => /^https?:\/\/\S+$/i.test(String(value || '').trim());

router.get('/api/staff/lecturer/overview', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    res.json({
      profile: {
        staffId: me.staffId, name: me.name, role: me.role, phone: me.phone,
        consultation: me.therapist ? { id: me.therapist.id, enabled: Boolean(me.therapist.is_consultation_enabled) } : null,
      },
      ...(await overviewOf(pool, me)),
    });
  } catch (error) { fail(res, error, 'overview'); }
});

// ── Lives ────────────────────────────────────────────────────────────────────

/** The live the lecturer sent, checked against the courses that are theirs. */
async function liveFields(me, body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.title !== undefined) {
    out.title = clean(body.title, 500);
    if (!out.title) throw bad('اكتب اسم اللايف', 'LIVE_TITLE');
  }
  if (!partial || body.scheduledAt !== undefined) {
    // The screen sends the UTC wall clock («YYYY-MM-DD HH:MM», as the administration's lives do) or an ISO instant.
    const raw = String(body.scheduledAt || '').trim();
    const at = new Date(/^d{4}-d{2}-d{2}[ T]d{2}:d{2}(:d{2})?$/.test(raw) ? `${raw.replace(' ', 'T')}${raw.length === 16 ? ':00' : ''}Z` : raw);
    if (Number.isNaN(at.getTime())) throw bad('حدّد تاريخ وساعة اللايف', 'LIVE_TIME');
    if (at.getTime() < Date.now() - 5 * 60 * 1000) throw bad('ميعاد اللايف لازم يكون في المستقبل', 'LIVE_PAST');
    out.scheduledAt = at;
  }
  if (!partial || body.streamUrl !== undefined) {
    out.streamUrl = clean(body.streamUrl, 2000);
    if (!httpUrl(out.streamUrl)) throw bad('حط رابط البث (Zoom أو Meet أو يوتيوب) وبيبدأ بـ https://', 'LIVE_URL');
  }
  if (body.durationMinutes !== undefined || !partial) {
    const minutes = Math.round(Number(body.durationMinutes ?? 60));
    if (!(minutes >= 10 && minutes <= 480)) throw bad('مدة اللايف من 10 دقايق لـ 8 ساعات', 'LIVE_DURATION');
    out.durationMinutes = minutes;
  }
  if (body.platform !== undefined || !partial) {
    const platform = String(body.platform || 'ZOOM').toUpperCase();
    out.platform = PLATFORMS.has(platform) ? platform : 'OTHER';
  }
  if (body.description !== undefined) out.description = clean(body.description, 4000) || null;
  if (body.visibility !== undefined || body.courseIds !== undefined || !partial) {
    const courseIds = Array.isArray(body.courseIds) ? body.courseIds.map(String) : [];
    const mine = new Set((await myCourses(pool, me)).map(course => course.id));
    if (courseIds.some(id => !mine.has(id))) throw bad('تقدر تختار كورساتك انت بس', 'LIVE_COURSE', 403);
    let visibility = String(body.visibility || (courseIds.length ? 'COURSE_SUBSCRIBERS' : 'ALL_SUBSCRIBERS')).toUpperCase();
    if (!VISIBILITIES.has(visibility)) visibility = 'ALL_SUBSCRIBERS';
    if (visibility === 'COURSE_SUBSCRIBERS' && !courseIds.length) throw bad('اختار الكورس اللي اللايف له', 'LIVE_COURSE_REQUIRED');
    out.visibility = visibility;
    out.targetCourseIds = visibility === 'COURSE_SUBSCRIBERS' ? courseIds : [];
  }
  return out;
}

router.get('/api/staff/lecturer/lives', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const [rows] = await pool.query(
      `SELECT ${LIVE_STREAM_COLS}, started_at, ended_at, announced_at,
              (SELECT COUNT(*) FROM live_stream_attendance a WHERE a.tenant_id=live_streams.tenant_id AND a.stream_id=live_streams.id) AS attendees
         FROM live_streams WHERE tenant_id=? AND instructor_id=? ORDER BY scheduled_at DESC LIMIT 100`,
      [me.tenantId, me.staffId]);
    res.json({
      lives: rows.map(row => ({ ...mapLiveStream(row), startedAt: row.started_at, endedAt: row.ended_at, announcedAt: row.announced_at, attendees: Number(row.attendees) || 0 })),
      courses: await myCourses(pool, me),
    });
  } catch (error) { fail(res, error, 'lives'); }
});

router.post('/api/staff/lecturer/lives', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const live = await liveFields(me, req.body || {});
    const id = uuidv4();
    await pool.query(
      `INSERT INTO live_streams (id, tenant_id, title, instructor_id, instructor_name, scheduled_at, duration_minutes,
         stream_url, platform, visibility, target_course_ids_json, status, description, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'UPCOMING', ?, NOW())`,
      [id, me.tenantId, live.title, me.staffId, me.name, live.scheduledAt, live.durationMinutes, live.streamUrl, live.platform,
        live.visibility, JSON.stringify(live.targetCourseIds), live.description || null]);
    const announced = await announceLiveStream(pool, { tenantId: me.tenantId, streamId: id })
      .catch(error => { logger.warn('[lecturer/lives] announce failed', { id, error: error.message }); return null; });
    res.json({ ok: true, id, announced });
  } catch (error) { fail(res, error, 'lives:create'); }
});

async function ownUpcomingLive(me, id) {
  const [[live]] = await pool.query(
    'SELECT id, status, scheduled_at FROM live_streams WHERE id=? AND tenant_id=? AND instructor_id=? LIMIT 1', [id, me.tenantId, me.staffId]);
  if (!live) throw bad('اللايف مش موجود', 'LIVE_NOT_FOUND', 404);
  if (live.status !== 'UPCOMING') throw bad('اللايف ده بدأ أو خلص — مينفعش يتغير', 'LIVE_STARTED', 409);
  return live;
}

router.patch('/api/staff/lecturer/lives/:id', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const before = await ownUpcomingLive(me, req.params.id);
    const live = await liveFields(me, req.body || {}, { partial: true });
    const sets = [];
    const params = [];
    const set = (column, value) => { sets.push(`${column}=?`); params.push(value); };
    if (live.title !== undefined) set('title', live.title);
    if (live.scheduledAt !== undefined) set('scheduled_at', live.scheduledAt);
    if (live.streamUrl !== undefined) set('stream_url', live.streamUrl);
    if (live.durationMinutes !== undefined) set('duration_minutes', live.durationMinutes);
    if (live.platform !== undefined) set('platform', live.platform);
    if (live.description !== undefined) set('description', live.description);
    if (live.visibility !== undefined) { set('visibility', live.visibility); set('target_course_ids_json', JSON.stringify(live.targetCourseIds)); }
    if (!sets.length) return res.json({ ok: true });
    await pool.query(`UPDATE live_streams SET ${sets.join(', ')} WHERE id=? AND tenant_id=? AND instructor_id=?`, [...params, before.id, me.tenantId, me.staffId]);
    // A new time is announced again to whoever was not told that time.
    const moved = live.scheduledAt && live.scheduledAt.getTime() !== new Date(before.scheduled_at).getTime();
    const announced = moved ? await announceLiveStream(pool, { tenantId: me.tenantId, streamId: before.id }).catch(() => null) : null;
    res.json({ ok: true, announced });
  } catch (error) { fail(res, error, 'lives:update'); }
});

router.delete('/api/staff/lecturer/lives/:id', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const live = await ownUpcomingLive(me, req.params.id);
    await pool.query('DELETE FROM live_streams WHERE id=? AND tenant_id=? AND instructor_id=? AND status=\'UPCOMING\'', [live.id, me.tenantId, me.staffId]);
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'lives:delete'); }
});

// «يبدأ لايف مجاني في المجتمع»: open to every community member, no payment — it starts now, and a post tells the community.
router.post('/api/staff/lecturer/community-live', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const title = clean(req.body?.title, 300);
    const streamUrl = clean(req.body?.streamUrl, 2000);
    if (!title) throw bad('اكتب اسم اللايف', 'LIVE_TITLE');
    if (!httpUrl(streamUrl)) throw bad('حط رابط البث وبيبدأ بـ https://', 'LIVE_URL');
    const platform = PLATFORMS.has(String(req.body?.platform || '').toUpperCase()) ? String(req.body.platform).toUpperCase() : 'OTHER';
    const liveId = uuidv4();
    const postId = `post-${uuidv4()}`;
    await pool.query(
      `INSERT INTO live_streams (id, tenant_id, title, instructor_id, instructor_name, scheduled_at, duration_minutes,
         stream_url, platform, visibility, target_course_ids_json, status, description, created_at, started_at)
       VALUES (?,?,?,?,?,NOW(),?,?,?,'COMMUNITY_ALL','[]','LIVE',?,NOW(),NOW())`,
      [liveId, me.tenantId, title, me.staffId, me.name, Math.round(Number(req.body?.durationMinutes) || 60), streamUrl, platform,
        clean(req.body?.description, 4000) || null]);
    await pool.query(
      `INSERT INTO community_posts (id, tenant_id, title, category, body, author, author_role, staff_id, tags, featured, pinned, likes, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,1,0,'approved',?)`,
      [postId, me.tenantId, `🔴 لايف مجاني الآن مع ${me.name}: ${title}`.slice(0, 500), 'live',
        `${clean(req.body?.description, 1500)}\n\nادخل اللايف من هنا (مجاني لكل أعضاء المجتمع): ${streamUrl}`.trim(), me.name, 'محاضر', me.staffId,
        JSON.stringify(['لايف']), new Date().toISOString()]);
    cacheInvalidate(`community:${me.tenantId}`);
    createNotification('community', '🔴 لايف مجاني في المجتمع', `${me.name}: ${title}`, { streamId: liveId, postId }, me.tenantId).catch(() => {});
    res.json({ ok: true, id: liveId, postId });
  } catch (error) { fail(res, error, 'community-live'); }
});

// ── Consultation hours ───────────────────────────────────────────────────────

router.get('/api/staff/lecturer/availability', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    if (!me.therapist) return res.json({ enabled: false, hasProfile: false, slots: [], blocked: [] });
    const [slots] = await pool.query(
      `SELECT s.id, s.day, s.start_time, s.end_time, s.timezone, s.label, s.meeting_link
         FROM therapist_slots s JOIN therapists t ON t.id=s.therapist_id
        WHERE s.therapist_id=? AND t.tenant_id=? AND s.is_active=1 ORDER BY s.day, s.start_time`, [me.therapist.id, me.tenantId]);
    res.json({
      enabled: Boolean(me.therapist.is_consultation_enabled), hasProfile: true,
      sessionDurationMinutes: me.therapist.session_duration_minutes || 60,
      slots: slots.map(s => ({ id: s.id, day: s.day, startTime: s.start_time, endTime: s.end_time, timezone: s.timezone, label: s.label || '', meetingLink: s.meeting_link || '' })),
      blocked: await blockedDatesOf(pool, { tenantId: me.tenantId, therapistId: me.therapist.id }),
    });
  } catch (error) { fail(res, error, 'availability'); }
});

/** The consultation profile the hours belong to — and only when consultations are switched on for this lecturer. */
function enabledTherapist(me) {
  if (!me.therapist) throw bad('مفيش ملف استشارات مربوط بحسابك — اطلب من الإدارة', 'NO_CONSULTATION_PROFILE', 409);
  if (!me.therapist.is_consultation_enabled) throw bad('الاستشارات مش مفعّلة على حسابك — اطلب من الإدارة تفعيلها', 'CONSULTATIONS_DISABLED', 409);
  return me.therapist;
}

router.put('/api/staff/lecturer/availability/slots', ...guard, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const me = req.lecturer;
    const therapist = enabledTherapist(me);
    const slots = normalizeSlots(req.body?.slots);
    await conn.beginTransaction();
    await replaceWeeklySlots(conn, { tenantId: me.tenantId, therapistId: therapist.id, slots });
    await conn.commit();
    cacheInvalidate('therapists');
    res.json({ ok: true, count: slots.length });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'availability:slots');
  } finally { conn.release(); }
});

router.post('/api/staff/lecturer/availability/blocked', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const therapist = enabledTherapist(me);
    const result = await blockDay(pool, { tenantId: me.tenantId, therapistId: therapist.id, date: clean(req.body?.date, 10), reason: req.body?.reason, actor: me.staffId });
    cacheInvalidate('therapists');
    res.json({ ok: true, ...result });
  } catch (error) { fail(res, error, 'availability:block'); }
});

router.delete('/api/staff/lecturer/availability/blocked/:id', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const therapist = enabledTherapist(me);
    const removed = await unblockDay(pool, { tenantId: me.tenantId, therapistId: therapist.id, id: req.params.id });
    if (!removed) throw bad('اليوم ده مش مقفول', 'BLOCK_NOT_FOUND', 404);
    cacheInvalidate('therapists');
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'availability:unblock'); }
});

// ── Consultations ────────────────────────────────────────────────────────────

router.get('/api/staff/lecturer/consultations', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    if (!me.therapist) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id, client_name, client_phone, session_type, session_date, status, notes, amount, currency,
              session_duration_minutes, meeting_link, created_at, source, paid_at
         FROM consultations WHERE tenant_id=? AND therapist_id=? AND deleted_at IS NULL
        ORDER BY (status IN ('PENDING','CONFIRMED')) DESC, session_date DESC LIMIT 300`, [me.tenantId, me.therapist.id]);
    res.json(rows.map(row => ({
      id: row.id, clientName: row.client_name, clientPhone: row.client_phone || '', sessionType: String(row.session_type || '').toLowerCase(),
      sessionDate: row.session_date, status: String(row.status || '').toLowerCase(), notes: row.notes || '', amount: row.amount === null ? null : Number(row.amount),
      currency: row.currency || null, minutes: row.session_duration_minutes || null, meetingLink: row.meeting_link || '', createdAt: row.created_at,
      source: row.source || null, paid: Boolean(row.paid_at),
    })));
  } catch (error) { fail(res, error, 'consultations'); }
});

router.patch('/api/staff/lecturer/consultations/:id', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    if (!me.therapist) throw bad('مفيش ملف استشارات مربوط بحسابك', 'NO_CONSULTATION_PROFILE', 409);
    const sets = [];
    const params = [];
    const status = req.body?.status === undefined ? null : String(req.body.status).toUpperCase();
    if (status !== null) {
      if (!['CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(status)) throw bad('حالة غير معروفة', 'CONSULTATION_STATUS');
      sets.push('status=?'); params.push(status);
    }
    if (req.body?.notes !== undefined) { sets.push('notes=?'); params.push(clean(req.body.notes, 4000)); }
    if (req.body?.meetingLink !== undefined) {
      const link = clean(req.body.meetingLink, 2000);
      if (link && !httpUrl(link)) throw bad('رابط الجلسة لازم يبدأ بـ https://', 'CONSULTATION_LINK');
      sets.push('meeting_link=?'); params.push(link || null);
    }
    if (!sets.length) return res.json({ ok: true });
    const [result] = await pool.query(
      `UPDATE consultations SET ${sets.join(', ')} WHERE id=? AND tenant_id=? AND therapist_id=? AND deleted_at IS NULL`,
      [...params, req.params.id, me.tenantId, me.therapist.id]);
    if (!result.affectedRows) throw bad('الاستشارة مش موجودة', 'CONSULTATION_NOT_FOUND', 404);
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'consultations:update'); }
});

// ── Ratings, students, money ─────────────────────────────────────────────────

router.get('/api/staff/lecturer/reviews', ...guard, async (req, res) => {
  try { res.json(await reviewsOf(pool, req.lecturer)); } catch (error) { fail(res, error, 'reviews'); }
});

router.get('/api/staff/lecturer/students', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    res.json({ ...(await studentsOf(pool, me)), roundsList: await myRounds(pool, me), courses: await myCourses(pool, me) });
  } catch (error) { fail(res, error, 'students'); }
});

router.get('/api/staff/lecturer/earnings', ...guard, async (req, res) => {
  try {
    const month = Number(req.query.month) || null;
    const year = Number(req.query.year) || null;
    res.json(await earningsOf(pool, { ...req.lecturer, month, year }));
  } catch (error) { fail(res, error, 'earnings'); }
});

// ── Notifications ────────────────────────────────────────────────────────────

router.get('/api/staff/lecturer/notifications', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const [rows] = await pool.query(
      `SELECT id, type, title, message, data_json, read_at, created_at FROM notifications
        WHERE tenant_id=? AND recipient_staff_id=? ORDER BY created_at DESC LIMIT 60`, [me.tenantId, me.staffId]);
    res.json(rows.map(row => ({ id: row.id, type: row.type, title: row.title || '', message: row.message || '', read: Boolean(row.read_at), at: row.created_at })));
  } catch (error) { fail(res, error, 'notifications'); }
});

router.post('/api/staff/lecturer/notifications/read', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    await pool.query('UPDATE notifications SET read_at=NOW() WHERE tenant_id=? AND recipient_staff_id=? AND read_at IS NULL', [me.tenantId, me.staffId]);
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'notifications:read'); }
});

// ── Profile ──────────────────────────────────────────────────────────────────

router.get('/api/staff/lecturer/profile', ...guard, async (req, res) => {
  const me = req.lecturer;
  const t = me.therapist;
  res.json({
    staffId: me.staffId, name: me.name, role: me.role, phone: me.phone,
    consultation: t ? {
      id: t.id, enabled: Boolean(t.is_consultation_enabled), title: t.title || '', specialty: t.specialty || '', bio: t.bio || '', image: t.image || '',
      sessionDurationMinutes: t.session_duration_minutes || 60,
    } : null,
  });
});

router.patch('/api/staff/lecturer/profile', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    if (!me.therapist) throw bad('مفيش ملف استشارات مربوط بحسابك — اطلب من الإدارة', 'NO_CONSULTATION_PROFILE', 409);
    const body = req.body || {};
    const sets = [];
    const params = [];
    for (const [key, column, max] of [['title', 'title', 255], ['specialty', 'specialty', 255], ['bio', 'bio', 4000]]) {
      if (body[key] !== undefined) { sets.push(`${column}=?`); params.push(clean(body[key], max)); }
    }
    if (body.image !== undefined) {
      const image = clean(body.image, 2000);
      if (image && !/^(https?:\/\/|\/uploads\/)/i.test(image)) throw bad('الصورة لازم تكون رابط', 'PROFILE_IMAGE');
      sets.push('image=?'); params.push(image);
    }
    if (!sets.length) return res.json({ ok: true });
    await pool.query(`UPDATE therapists SET ${sets.join(', ')} WHERE id=? AND tenant_id=? AND staff_id=?`, [...params, me.therapist.id, me.tenantId, me.staffId]);
    cacheInvalidate('therapists');
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'profile'); }
});

// ── The community, as a lecturer ─────────────────────────────────────────────
// «يشارك في المجتمع بكامل المحتوى»: the lecturer reads everything the community has (the public feed, library, videos and
// events are the same endpoints members use) and takes part with the «محاضر» badge — their posts need no review.

router.post('/api/staff/lecturer/community/posts', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const title = clean(req.body?.title, 200);
    const body = clean(req.body?.body, 5000);
    if (!title || !body) throw bad('اكتب العنوان والمنشور', 'POST_REQUIRED');
    const id = `post-${uuidv4()}`;
    const image = clean(req.body?.imageUrl, 2000);
    await pool.query(
      `INSERT INTO community_posts (id, tenant_id, title, category, body, author, author_role, staff_id, image_url, tags, featured, pinned, likes, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,0,0,'approved',?)`,
      [id, me.tenantId, title, clean(req.body?.category, 100) || 'general', body, me.name, 'محاضر', me.staffId,
        /^(https?:\/\/|\/uploads\/)/i.test(image) ? image : null, JSON.stringify(Array.isArray(req.body?.tags) ? req.body.tags.slice(0, 8).map(tag => clean(tag, 40)) : []), new Date().toISOString()]);
    cacheInvalidate(`community:${me.tenantId}`);
    res.json({ ok: true, id });
  } catch (error) { fail(res, error, 'community:post'); }
});

router.post('/api/staff/lecturer/community/posts/:id/comments', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const body = clean(req.body?.body, 2000);
    if (!body) throw bad('اكتب التعليق', 'COMMENT_REQUIRED');
    const [[post]] = await pool.query("SELECT id FROM community_posts WHERE tenant_id=? AND id=? AND status='approved'", [me.tenantId, req.params.id]);
    if (!post) throw bad('المنشور مش موجود', 'POST_NOT_FOUND', 404);
    const id = uuidv4();
    await pool.query(
      'INSERT INTO community_post_comments (id, tenant_id, post_id, subscriber_id, author, body, created_at) VALUES (?,?,?,?,?,?,NOW())',
      [id, me.tenantId, post.id, `staff:${me.staffId}`, `${me.name} (محاضر)`.slice(0, 200), body]);
    cacheInvalidate(`community:${me.tenantId}`);
    res.json({ ok: true, comment: { id, author: `${me.name} (محاضر)`, body, at: new Date().toISOString() } });
  } catch (error) { fail(res, error, 'community:comment'); }
});

router.post('/api/staff/lecturer/community/posts/:id/like', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const [[post]] = await pool.query("SELECT id FROM community_posts WHERE tenant_id=? AND id=? AND status='approved'", [me.tenantId, req.params.id]);
    if (!post) throw bad('المنشور مش موجود', 'POST_NOT_FOUND', 404);
    const [added] = await pool.query(
      'INSERT IGNORE INTO community_post_likes (tenant_id, post_id, subscriber_id) VALUES (?,?,?)', [me.tenantId, post.id, `staff:${me.staffId}`]);
    if (added.affectedRows) await pool.query('UPDATE community_posts SET likes=COALESCE(likes,0)+1 WHERE tenant_id=? AND id=?', [me.tenantId, post.id]);
    cacheInvalidate(`community:${me.tenantId}`);
    res.json({ ok: true, liked: Boolean(added.affectedRows) });
  } catch (error) { fail(res, error, 'community:like'); }
});

router.delete('/api/staff/lecturer/community/posts/:id', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const [result] = await pool.query('DELETE FROM community_posts WHERE tenant_id=? AND id=? AND staff_id=?', [me.tenantId, req.params.id, me.staffId]);
    if (!result.affectedRows) throw bad('ده مش منشورك', 'POST_NOT_YOURS', 404);
    cacheInvalidate(`community:${me.tenantId}`);
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'community:delete'); }
});

module.exports = router;
