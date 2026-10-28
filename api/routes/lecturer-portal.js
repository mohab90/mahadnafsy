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
const { requireAuth, requireAdminOrStaff, requireAnyPermission } = require('../middleware/auth');
const { LIVE_STREAM_COLS, mapLiveStream } = require('../lib/mappers');
const { announceLiveStream } = require('../lib/liveStreams');
const { integrationStatus, createMeeting, deleteMeeting } = require('../lib/meetingProvider');
const { ensureConsultationMeeting } = require('../lib/consultationMeetings');
const { onConsultationCompleted } = require('../lib/consultationCompletion');
const { saveConsultationRating, validRatingToken } = require('../lib/consultationRating');
const { decideReschedule, humanAt, proposeReschedule, validRequestToken, validRespondToken } = require('../lib/consultationReschedule');
const { consultationClock, consultationSettings } = require('../lib/consultationRequests');
const { getTenantSetting } = require('../lib/tenantSettings');
const { storeMediaImage } = require('../lib/mediaImages');
const { sendRouteError } = require('../lib/helpers');
const { markRoundAttendance, unmarkRoundAttendance } = require('../lib/daqqiAttendanceMark');
const { lectureToday } = require('../lib/daqqiLecture');
const { ymd } = require('../lib/helpers');
const { publicLimiter } = require('../middleware/rateLimits');
const { createNotification } = require('../lib/notification');
const {
  earningsOf, myCourses, myRounds, overviewOf, requireLecturer, reviewsOf, studentsOf,
} = require('../lib/lecturerPortal');
const {
  blockDay, blockedDatesOf, normalizeSlots, replaceWeeklySlots, unblockDay,
} = require('../lib/therapistAvailability');

// use_lecturer_portal is the grant; the jobs' own permissions also open it, so an account whose list was saved before this
// permission existed is not locked out — requireLecturer then keeps it to lecturers' accounts.
const PAYOUT_TITLE = '💰 طلب صرف مستحقات محاضر';
const guard = [requireAuth, requireAdminOrStaff, requireAnyPermission('use_lecturer_portal', 'manage_lectures', 'manage_consultations', 'view_consultations'), requireLecturer(pool)];
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
      // What this account can do: a lecturer's lives and courses, a consultant's sessions, a branch round's attendance — both jobs on one login.
      capabilities: {
        lecturer: ['instructor', 'trainer', 'expert'].includes(me.role) || (await myCourses(pool, me)).length > 0,
        consultant: Boolean(me.therapist?.is_consultation_enabled),
        branchRounds: (await myRounds(pool, me)).length > 0,
        systemMeetings: (await integrationStatus(me.tenantId)).configured,
      },
      ...(await overviewOf(pool, me)),
    });
  } catch (error) { fail(res, error, 'overview'); }
});

// ── Lives ────────────────────────────────────────────────────────────────────

/** The room the system makes for a live (lib/meetingProvider.js); the screens keep a live's hour in UTC. */
async function makeRoom(me, live) {
  try {
    const meeting = await createMeeting(me.tenantId, {
      topic: live.title, startLocal: new Date(live.scheduledAt).toISOString().slice(0, 19), timeZone: 'UTC', durationMinutes: live.durationMinutes,
    });
    if (!meeting?.joinUrl) throw new Error('no room');
    return { ...meeting, platform: meeting.provider === 'zoom' ? 'ZOOM' : 'MEET' };
  } catch (error) {
    logger.error('[lecturer/lives] meeting provider', error.message);
    throw bad('السيستم معرفش يعمل غرفة اللايف دلوقتي — جرب تاني بعد شوية أو بلّغ الإدارة', 'LIVE_ROOM', 502);
  }
}

/** The live the lecturer sent, checked against the courses that are theirs. */
async function liveFields(me, body, { partial = false, integrated = false } = {}) {
  const out = {};
  if (!partial || body.title !== undefined) {
    out.title = clean(body.title, 500);
    if (!out.title) throw bad('اكتب اسم اللايف', 'LIVE_TITLE');
  }
  if (!partial || body.scheduledAt !== undefined) {
    // The screen sends the UTC wall clock («YYYY-MM-DD HH:MM», as the administration's lives do) or an ISO instant.
    const raw = String(body.scheduledAt || '').trim();
    const at = new Date(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw) ? `${raw.replace(' ', 'T')}${raw.length === 16 ? ':00' : ''}Z` : raw);
    if (Number.isNaN(at.getTime())) throw bad('حدّد تاريخ وساعة اللايف', 'LIVE_TIME');
    if (at.getTime() < Date.now() - 5 * 60 * 1000) throw bad('ميعاد اللايف لازم يكون في المستقبل', 'LIVE_PAST');
    out.scheduledAt = at;
  }
  // With the institute's Zoom / Meet account set up the system makes the room: the lecturer types no link and picks no platform.
  if (!integrated && (!partial || body.streamUrl !== undefined)) {
    out.streamUrl = clean(body.streamUrl, 2000);
    if (!httpUrl(out.streamUrl)) throw bad('حط رابط البث (Zoom أو Meet أو يوتيوب) وبيبدأ بـ https://', 'LIVE_URL');
  }
  if (body.durationMinutes !== undefined || !partial) {
    const minutes = Math.round(Number(body.durationMinutes ?? 60));
    if (!(minutes >= 10 && minutes <= 480)) throw bad('مدة اللايف من 10 دقايق لـ 8 ساعات', 'LIVE_DURATION');
    out.durationMinutes = minutes;
  }
  if (!integrated && (body.platform !== undefined || !partial)) {
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
      `SELECT ${LIVE_STREAM_COLS}, started_at, ended_at, announced_at, host_url,
              (SELECT COUNT(*) FROM live_stream_attendance a WHERE a.tenant_id=live_streams.tenant_id AND a.stream_id=live_streams.id) AS attendees
         FROM live_streams WHERE tenant_id=? AND instructor_id=? ORDER BY scheduled_at DESC LIMIT 100`,
      [me.tenantId, me.staffId]);
    res.json({
      lives: rows.map(row => ({ ...mapLiveStream(row), startedAt: row.started_at, endedAt: row.ended_at, announcedAt: row.announced_at, hostUrl: row.host_url || '', attendees: Number(row.attendees) || 0 })),
      courses: await myCourses(pool, me),
      meeting: { systemMade: (await integrationStatus(me.tenantId)).configured },
    });
  } catch (error) { fail(res, error, 'lives'); }
});

router.post('/api/staff/lecturer/lives', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const integrated = (await integrationStatus(me.tenantId)).configured;
    const live = await liveFields(me, req.body || {}, { integrated });
    const room = integrated ? await makeRoom(me, live) : null;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO live_streams (id, tenant_id, title, instructor_id, instructor_name, scheduled_at, duration_minutes,
         stream_url, platform, visibility, target_course_ids_json, status, description, created_at, host_url, meeting_id, meeting_provider)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'UPCOMING', ?, NOW(), ?,?,?)`,
      [id, me.tenantId, live.title, me.staffId, me.name, live.scheduledAt, live.durationMinutes, room ? room.joinUrl : live.streamUrl, room ? room.platform : live.platform,
        live.visibility, JSON.stringify(live.targetCourseIds), live.description || null, room?.hostUrl || null, room?.meetingId || null, room?.provider || null]);
    const announced = await announceLiveStream(pool, { tenantId: me.tenantId, streamId: id })
      .catch(error => { logger.warn('[lecturer/lives] announce failed', { id, error: error.message }); return null; });
    res.json({ ok: true, id, announced });
  } catch (error) { fail(res, error, 'lives:create'); }
});

async function ownUpcomingLive(me, id) {
  const [[live]] = await pool.query(
    'SELECT id, title, status, scheduled_at, duration_minutes, meeting_id, meeting_provider FROM live_streams WHERE id=? AND tenant_id=? AND instructor_id=? LIMIT 1', [id, me.tenantId, me.staffId]);
  if (!live) throw bad('اللايف مش موجود', 'LIVE_NOT_FOUND', 404);
  if (live.status !== 'UPCOMING') throw bad('اللايف ده بدأ أو خلص — مينفعش يتغير', 'LIVE_STARTED', 409);
  return live;
}

router.patch('/api/staff/lecturer/lives/:id', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const before = await ownUpcomingLive(me, req.params.id);
    const integrated = Boolean(before.meeting_id) && (await integrationStatus(me.tenantId)).configured;
    const live = await liveFields(me, req.body || {}, { partial: true, integrated });
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
    // A moved or lengthened live needs its room moved: the old one goes, and a new one is made for the new hour.
    if (integrated && (live.scheduledAt !== undefined || live.durationMinutes !== undefined || live.title !== undefined)) {
      const room = await makeRoom(me, {
        title: live.title ?? before.title, scheduledAt: live.scheduledAt ?? new Date(before.scheduled_at), durationMinutes: live.durationMinutes ?? before.duration_minutes ?? 60,
      });
      deleteMeeting(me.tenantId, { provider: before.meeting_provider, meetingId: before.meeting_id }).catch(() => false);
      set('stream_url', room.joinUrl); set('platform', room.platform); set('host_url', room.hostUrl); set('meeting_id', room.meetingId); set('meeting_provider', room.provider);
    }
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
    if (live.meeting_id) deleteMeeting(me.tenantId, { provider: live.meeting_provider, meetingId: live.meeting_id }).catch(() => false);
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'lives:delete'); }
});

// «يبدأ لايف مجاني في المجتمع»: open to every community member, no payment — it starts now, and a post tells the community.
router.post('/api/staff/lecturer/community-live', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const title = clean(req.body?.title, 300);
    const integrated = (await integrationStatus(me.tenantId)).configured;
    const room = integrated ? await makeRoom(me, { title, scheduledAt: new Date(), durationMinutes: Math.round(Number(req.body?.durationMinutes) || 60) }) : null;
    const streamUrl = room ? room.joinUrl : clean(req.body?.streamUrl, 2000);
    if (!title) throw bad('اكتب اسم اللايف', 'LIVE_TITLE');
    if (!httpUrl(streamUrl)) throw bad('حط رابط البث وبيبدأ بـ https://', 'LIVE_URL');
    const platform = room ? room.platform : PLATFORMS.has(String(req.body?.platform || '').toUpperCase()) ? String(req.body.platform).toUpperCase() : 'OTHER';
    const liveId = uuidv4();
    const postId = `post-${uuidv4()}`;
    await pool.query(
      `INSERT INTO live_streams (id, tenant_id, title, instructor_id, instructor_name, scheduled_at, duration_minutes,
         stream_url, platform, visibility, target_course_ids_json, status, description, created_at, started_at, host_url, meeting_id, meeting_provider)
       VALUES (?,?,?,?,?,NOW(),?,?,?,'COMMUNITY_ALL','[]','LIVE',?,NOW(),NOW(),?,?,?)`,
      [liveId, me.tenantId, title, me.staffId, me.name, Math.round(Number(req.body?.durationMinutes) || 60), streamUrl, platform,
        clean(req.body?.description, 4000) || null, room?.hostUrl || null, room?.meetingId || null, room?.provider || null]);
    await pool.query(
      `INSERT INTO community_posts (id, tenant_id, title, category, body, author, author_role, staff_id, tags, featured, pinned, likes, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,1,0,'approved',?)`,
      [postId, me.tenantId, `🔴 لايف مجاني الآن مع ${me.name}: ${title}`.slice(0, 500), 'live',
        `${clean(req.body?.description, 1500)}\n\nادخل اللايف من هنا (مجاني لكل أعضاء المجتمع): ${streamUrl}`.trim(), me.name, 'محاضر', me.staffId,
        JSON.stringify(['لايف']), new Date().toISOString()]);
    cacheInvalidate(`community:${me.tenantId}`);
    createNotification('community', '🔴 لايف مجاني في المجتمع', `${me.name}: ${title}`, { streamId: liveId, postId }, me.tenantId).catch(() => {});
    res.json({ ok: true, id: liveId, postId, hostUrl: room?.hostUrl || null });
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
              session_duration_minutes, meeting_link, host_link, meeting_id, created_at, source, paid_at
         FROM consultations WHERE tenant_id=? AND therapist_id=? AND deleted_at IS NULL
        ORDER BY (status IN ('PENDING','CONFIRMED')) DESC, session_date DESC LIMIT 300`, [me.tenantId, me.therapist.id]);
    // A proposal waiting for an answer, on the consultation it is about (lib/consultationReschedule.js).
    const waiting = new Map();
    if (rows.length) {
      const [proposals] = await pool.query(
        `SELECT id, consultation_id, proposed_by, DATE_FORMAT(new_session_at, '%Y-%m-%d %H:%i:00') AS new_at, reason FROM consultation_reschedules
          WHERE tenant_id=? AND status='pending' AND consultation_id IN (${rows.map(() => '?').join(',')})`, [me.tenantId, ...rows.map(row => row.id)]);
      for (const proposal of proposals) waiting.set(proposal.consultation_id, { id: proposal.id, by: proposal.proposed_by, at: humanAt(proposal.new_at), reason: proposal.reason || '' });
    }
    res.json(rows.map(row => ({
      id: row.id, clientName: row.client_name, clientPhone: row.client_phone || '', sessionType: String(row.session_type || '').toLowerCase(),
      sessionDate: row.session_date, sessionTime: consultationClock(row), status: String(row.status || '').toLowerCase(), notes: row.notes || '',
      amount: row.amount === null ? null : Number(row.amount),
      currency: row.currency || null, minutes: row.session_duration_minutes || null, meetingLink: row.meeting_link || '', hostLink: row.host_link || '', systemMade: Boolean(row.meeting_id), createdAt: row.created_at,
      source: row.source || null, paid: Boolean(row.paid_at), pendingReschedule: waiting.get(row.id) || null,
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
      if ((await integrationStatus(me.tenantId)).configured) throw bad('الروابط بيعملها السيستم لوحده — اضغط «ابدأ الجلسة» وهتفتحلك', 'CONSULTATION_LINK_SYSTEM', 409);
      const link = clean(req.body.meetingLink, 2000);
      if (link && !httpUrl(link)) throw bad('رابط الجلسة لازم يبدأ بـ https://', 'CONSULTATION_LINK');
      sets.push('meeting_link=?'); params.push(link || null);
    }
    if (!sets.length) return res.json({ ok: true });
    const [result] = await pool.query(
      `UPDATE consultations SET ${sets.join(', ')} WHERE id=? AND tenant_id=? AND therapist_id=? AND deleted_at IS NULL`,
      [...params, req.params.id, me.tenantId, me.therapist.id]);
    if (!result.affectedRows) throw bad('الاستشارة مش موجودة', 'CONSULTATION_NOT_FOUND', 404);
    if (status === 'COMPLETED') await onConsultationCompleted(pool, { tenantId: me.tenantId, consultationId: req.params.id, actor: me.staffId });
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'consultations:update'); }
});

// «ابدأ الجلسة»: the lecturer's host link — the system makes the meeting now if it has not yet.
router.post('/api/staff/lecturer/consultations/:id/start', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    if (!me.therapist) throw bad('مفيش ملف استشارات مربوط بحسابك', 'NO_CONSULTATION_PROFILE', 409);
    const [[row]] = await pool.query(
      'SELECT id, meeting_link, host_link FROM consultations WHERE id=? AND tenant_id=? AND therapist_id=? AND deleted_at IS NULL LIMIT 1', [req.params.id, me.tenantId, me.therapist.id]);
    if (!row) throw bad('الاستشارة مش موجودة', 'CONSULTATION_NOT_FOUND', 404);
    let hostLink = row.host_link || '';
    if (!hostLink && (await integrationStatus(me.tenantId)).configured) {
      const made = await ensureConsultationMeeting(pool, { tenantId: me.tenantId, consultationId: row.id });
      hostLink = made?.hostLink || '';
    }
    hostLink = hostLink || row.meeting_link || '';
    if (!hostLink) throw bad('لسه مفيش رابط للجلسة دي — الجلسة لازم تكون مؤكدة وليها ميعاد', 'CONSULTATION_NO_LINK', 409);
    res.json({ ok: true, hostLink });
  } catch (error) { fail(res, error, 'consultations:start'); }
});

// ── Ratings, students, money ─────────────────────────────────────────────────

router.get('/api/staff/lecturer/reviews', ...guard, async (req, res) => {
  try { res.json(await reviewsOf(pool, { ...req.lecturer, therapistId: req.lecturer.therapist?.id || null })); } catch (error) { fail(res, error, 'reviews'); }
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

// ── Attendance of the lecturer's own Dokki rounds ────────────────────────────────────────────────────────────────────────

async function ownRound(me, roundId) {
  const [[round]] = await pool.query(
    `SELECT r.id, r.code, r.status, r.start_date, r.postponed_weeks_json, COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title
       FROM daqqi_rounds r LEFT JOIN courses c ON c.id=r.course_id AND c.tenant_id=r.tenant_id
      WHERE r.id=? AND r.tenant_id=? AND r.instructor_id=? LIMIT 1`, [roundId, me.tenantId, me.staffId]);
  if (!round) throw bad('الروند ده مش بتاعك', 'ROUND_NOT_YOURS', 404);
  return round;
}

router.get('/api/staff/lecturer/rounds/:roundId/attendance', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const round = await ownRound(me, req.params.roundId);
    let postponed = [];
    try { postponed = JSON.parse(round.postponed_weeks_json || '[]'); } catch { postponed = []; }
    const [attendees] = await pool.query(
      'SELECT subscriber_id, name, attended_lectures FROM daqqi_attendees WHERE tenant_id=? AND round_id=? ORDER BY name', [me.tenantId, round.id]);
    const [events] = await pool.query(
      "SELECT subscriber_id, session_number FROM daqqi_attendance_events WHERE tenant_id=? AND round_id=? AND status='PRESENT'", [me.tenantId, round.id]);
    const sessions = new Map();
    for (const event of events) (sessions.get(event.subscriber_id) || sessions.set(event.subscriber_id, []).get(event.subscriber_id)).push(Number(event.session_number));
    res.json({
      round: { id: round.id, code: round.code, status: String(round.status || '').toLowerCase(), course: round.course_title || '', session: Math.max(1, lectureToday(ymd(round.start_date), postponed)) },
      attendees: attendees.map(row => ({ subscriberId: row.subscriber_id, name: row.name || '', attended: Number(row.attended_lectures) || 0, sessions: (sessions.get(row.subscriber_id) || []).sort((a, b) => a - b) })),
    });
  } catch (error) { fail(res, error, 'attendance:read'); }
});

// «تسجيل الحضور» for the clients ticked: each is marked at the session the round is on (or the one named); one already marked is
// reported, not an error.
router.post('/api/staff/lecturer/rounds/:roundId/attendance', ...guard, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const me = req.lecturer;
    const round = await ownRound(me, req.params.roundId);
    const ids = [...new Set((Array.isArray(req.body?.subscriberIds) ? req.body.subscriberIds : []).map(String).filter(Boolean))].slice(0, 300);
    if (!ids.length) throw bad('اختار طالب واحد على الأقل', 'ATTENDANCE_NONE');
    await conn.beginTransaction();
    const out = { marked: 0, already: 0, failed: 0 };
    for (const subscriberId of ids) {
      try {
        await markRoundAttendance(conn, { tenantId: me.tenantId, roundId: round.id, subscriberId, sessionNumber: req.body?.sessionNumber, markedBy: me.staffId, req });
        out.marked += 1;
      } catch (error) {
        if (error?.code === 'ATTENDANCE_ALREADY_MARKED') out.already += 1;
        else if (error?.attendance && error.statusCode === 409 && error.code === 'ROUND_FINISHED') throw bad('الروند خلص — مينفعش تسجل حضور', 'ROUND_FINISHED', 409);
        else if (error?.attendance) out.failed += 1;
        else throw error;
      }
    }
    await conn.commit();
    res.json({ ok: true, ...out });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'attendance:mark');
  } finally { conn.release(); }
});

router.delete('/api/staff/lecturer/rounds/:roundId/attendance/:subscriberId/:sessionNumber', ...guard, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const me = req.lecturer;
    const round = await ownRound(me, req.params.roundId);
    await conn.beginTransaction();
    await unmarkRoundAttendance(conn, { tenantId: me.tenantId, roundId: round.id, subscriberId: req.params.subscriberId, sessionNumber: Number(req.params.sessionNumber), req });
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'attendance:unmark');
  } finally { conn.release(); }
});

// ── Payout request ───────────────────────────────────────────────────────────────────────────────────────────────────────

// «طلب صرف»: tells the accounts team, once every three days, what is approved and not yet paid — the payroll still pays it.
router.post('/api/staff/lecturer/payout-request', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const { totals } = await earningsOf(pool, me);
    if (!(totals.approved > 0)) throw bad('مفيش مبلغ معتمد ينفع يتطلب صرفه دلوقتي', 'PAYOUT_NOTHING', 409);
    const [[recent]] = await pool.query(
      `SELECT 1 AS ok FROM notifications WHERE tenant_id=? AND type='payroll' AND title=? AND data_json LIKE ?
          AND created_at >= NOW() - INTERVAL 3 DAY LIMIT 1`,
      [me.tenantId, PAYOUT_TITLE, `%"staffId":"${me.staffId}"%`]);
    if (recent) throw bad('طلبت الصرف قريب — الحسابات شافت الطلب، استنى 3 أيام قبل ما تبعته تاني', 'PAYOUT_RECENT', 429);
    await createNotification('payroll', PAYOUT_TITLE, `${me.name} بيطلب صرف مستحقاته المعتمدة: ${totals.approved} ج.م`, { staffId: me.staffId, amount: totals.approved }, me.tenantId);
    res.json({ ok: true, amount: totals.approved });
  } catch (error) { fail(res, error, 'payout-request'); }
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

// The lecturer's photo, stored like every picture the site shows (lib/mediaImages.js) — what the profile and their community posts carry.
router.post('/api/staff/lecturer/media/image', ...guard, async (req, res) => {
  try { res.json(await storeMediaImage({ tenantId: req.lecturer.tenantId, dataUrl: req.body?.dataUrl, kind: 'photo' })); }
  catch (error) { sendRouteError(res, error); }
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
    await pool.query(
      `INSERT INTO community_posts (id, tenant_id, title, category, body, author, author_role, staff_id, image_url, tags, featured, pinned, likes, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,0,0,'approved',?)`,
      [id, me.tenantId, title, clean(req.body?.category, 100) || 'general', body, me.name, 'محاضر', me.staffId,
        me.therapist?.image || null, JSON.stringify(Array.isArray(req.body?.tags) ? req.body.tags.slice(0, 8).map(tag => clean(tag, 40)) : []), new Date().toISOString()]);
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

// A comment on the lecturer's own post, or one they wrote, can be taken down; nobody else's post is theirs to moderate.
router.delete('/api/staff/lecturer/community/comments/:id', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    const [result] = await pool.query(
      `DELETE c FROM community_post_comments c
         LEFT JOIN community_posts p ON p.id=c.post_id AND p.tenant_id=c.tenant_id
        WHERE c.tenant_id=? AND c.id=? AND (c.subscriber_id=? OR p.staff_id=?)`,
      [me.tenantId, req.params.id, `staff:${me.staffId}`, me.staffId]);
    if (!result.affectedRows) throw bad('التعليق ده مش على منشورك ومش تعليقك', 'COMMENT_NOT_YOURS', 404);
    cacheInvalidate(`community:${me.tenantId}`);
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'community:comment-delete'); }
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

// ── Moving a consultation (lib/consultationReschedule.js) ───────────────────────────────────────────────────────────────

async function bookingSettings(tenantId) {
  return consultationSettings(await getTenantSetting('content', { tenantId, fallback: {} }));
}

// The lecturer proposes another day and one of their weekly hours; the client is asked on WhatsApp.
router.post('/api/staff/lecturer/consultations/:id/reschedule', ...guard, async (req, res) => {
  try {
    const me = req.lecturer;
    if (!me.therapist) throw bad('مفيش ملف استشارات مربوط بحسابك', 'NO_CONSULTATION_PROFILE', 409);
    const [[own]] = await pool.query('SELECT id FROM consultations WHERE id=? AND tenant_id=? AND therapist_id=? AND deleted_at IS NULL LIMIT 1', [req.params.id, me.tenantId, me.therapist.id]);
    if (!own) throw bad('الاستشارة مش موجودة', 'CONSULTATION_NOT_FOUND', 404);
    const result = await proposeReschedule(pool, {
      tenantId: me.tenantId, consultationId: own.id, by: 'lecturer', date: clean(req.body?.date, 10), slotId: clean(req.body?.slotId, 36),
      reason: req.body?.reason, settings: await bookingSettings(me.tenantId),
    });
    res.json({ ok: true, ...result });
  } catch (error) { fail(res, error, 'reschedule:propose'); }
});

// The lecturer answers a client's request.
router.post('/api/staff/lecturer/reschedules/:id/answer', ...guard, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const me = req.lecturer;
    if (!me.therapist) throw bad('مفيش ملف استشارات مربوط بحسابك', 'NO_CONSULTATION_PROFILE', 409);
    const [[own]] = await conn.query(
      `SELECT r.id FROM consultation_reschedules r JOIN consultations c ON c.id=r.consultation_id AND c.tenant_id=r.tenant_id
        WHERE r.id=? AND r.tenant_id=? AND c.therapist_id=? LIMIT 1`, [req.params.id, me.tenantId, me.therapist.id]);
    if (!own) throw bad('الطلب مش موجود', 'RESCHEDULE_NOT_FOUND', 404);
    await conn.beginTransaction();
    const result = await decideReschedule(conn, { tenantId: me.tenantId, id: own.id, by: 'lecturer', answer: String(req.body?.answer || ''), note: req.body?.note });
    await conn.commit();
    res.json({ ok: true, ...result });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'reschedule:answer');
  } finally { conn.release(); }
});

// The client, from their WhatsApp link: see a proposal and answer it…
async function respondableRequest(requestId, token) {
  if (!validRespondToken(requestId, token)) throw bad('الرابط غير صالح أو انتهت صلاحيته', 'RESCHEDULE_LINK', 404);
  const [[row]] = await pool.query(
    `SELECT r.id, r.tenant_id, r.status, r.reason, r.proposed_by, DATE_FORMAT(r.old_session_at, '%Y-%m-%d %H:%i:00') AS old_at,
            DATE_FORMAT(r.new_session_at, '%Y-%m-%d %H:%i:00') AS new_at, t.name AS therapist_name
       FROM consultation_reschedules r
       JOIN consultations c ON c.id=r.consultation_id AND c.tenant_id=r.tenant_id
       LEFT JOIN therapists t ON t.id=c.therapist_id AND t.tenant_id=c.tenant_id
      WHERE r.id=? AND r.proposed_by='lecturer' LIMIT 1`, [requestId]);
  if (!row) throw bad('الرابط غير صالح أو انتهت صلاحيته', 'RESCHEDULE_LINK', 404);
  return row;
}

router.get('/api/public/consultation-reschedule/respond/:id', publicLimiter, async (req, res) => {
  try {
    const row = await respondableRequest(req.params.id, req.query.t);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ therapistName: row.therapist_name || '', current: humanAt(row.old_at), proposed: humanAt(row.new_at), reason: row.reason || '', status: row.status });
  } catch (error) { fail(res, error, 'reschedule:read'); }
});

router.post('/api/public/consultation-reschedule/respond/:id', publicLimiter, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const row = await respondableRequest(req.params.id, req.query.t);
    await conn.beginTransaction();
    const result = await decideReschedule(conn, { tenantId: row.tenant_id, id: row.id, by: 'client', answer: String(req.body?.answer || ''), note: req.body?.note });
    await conn.commit();
    res.json({ ok: true, status: result.status, at: humanAt(result.at) });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'reschedule:respond');
  } finally { conn.release(); }
});

// …or ask for another day and hour themselves, from the lecturer's open ones.
async function movableConsultation(consultationId, token) {
  if (!validRequestToken(consultationId, token)) throw bad('الرابط غير صالح أو انتهت صلاحيته', 'RESCHEDULE_LINK', 404);
  const [[row]] = await pool.query(
    `SELECT c.id, c.tenant_id, c.therapist_id, c.status, DATE_FORMAT(c.session_date, '%Y-%m-%d %H:%i:00') AS at, t.name AS therapist_name
       FROM consultations c LEFT JOIN therapists t ON t.id=c.therapist_id AND t.tenant_id=c.tenant_id
      WHERE c.id=? AND c.deleted_at IS NULL LIMIT 1`, [consultationId]);
  if (!row || !['PENDING', 'CONFIRMED'].includes(row.status)) throw bad('الرابط غير صالح أو انتهت صلاحيته', 'RESCHEDULE_LINK', 404);
  return row;
}

router.get('/api/public/consultation-reschedule/request/:id', publicLimiter, async (req, res) => {
  try {
    const row = await movableConsultation(req.params.id, req.query.t);
    const [slots] = await pool.query(
      `SELECT s.id, s.day, s.start_time, s.end_time FROM therapist_slots s JOIN therapists t ON t.id=s.therapist_id
        WHERE s.therapist_id=? AND t.tenant_id=? AND s.is_active=1 ORDER BY s.day, s.start_time`, [row.therapist_id, row.tenant_id]);
    const settings = await bookingSettings(row.tenant_id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      therapistName: row.therapist_name || '', current: humanAt(row.at), bookingWindowDays: settings.bookingWindowDays,
      slots: slots.map(slot => ({ id: slot.id, day: slot.day, startTime: slot.start_time, endTime: slot.end_time })),
      blockedDates: (await blockedDatesOf(pool, { tenantId: row.tenant_id, therapistId: row.therapist_id })).map(day => day.date),
    });
  } catch (error) { fail(res, error, 'reschedule:request-read'); }
});

router.post('/api/public/consultation-reschedule/request/:id', publicLimiter, async (req, res) => {
  try {
    const row = await movableConsultation(req.params.id, req.query.t);
    const result = await proposeReschedule(pool, {
      tenantId: row.tenant_id, consultationId: row.id, by: 'client', date: clean(req.body?.date, 10), slotId: clean(req.body?.slotId, 36),
      reason: req.body?.reason, settings: await bookingSettings(row.tenant_id),
    });
    res.json({ ok: true, at: humanAt(result.at) });
  } catch (error) { fail(res, error, 'reschedule:request'); }
});

// ── The client rates a consultation (their own link, lib/consultationRating.js) ─────────────────────────────────────────

async function ratableConsultation(id, token) {
  if (!validRatingToken(id, token)) throw bad('الرابط غير صالح أو انتهت صلاحيته', 'RATING_LINK', 404);
  const [[row]] = await pool.query(
    `SELECT c.id, c.tenant_id, c.therapist_id, c.status, t.name AS therapist_name
       FROM consultations c LEFT JOIN therapists t ON t.id=c.therapist_id AND t.tenant_id=c.tenant_id
      WHERE c.id=? AND c.deleted_at IS NULL LIMIT 1`, [id]);
  if (!row || row.status !== 'COMPLETED') throw bad('الرابط غير صالح أو انتهت صلاحيته', 'RATING_LINK', 404);
  return row;
}

router.get('/api/public/consultation-rating/:id', publicLimiter, async (req, res) => {
  try {
    const row = await ratableConsultation(req.params.id, req.query.t);
    const [[rated]] = await pool.query('SELECT 1 AS ok FROM consultation_ratings WHERE tenant_id=? AND consultation_id=? LIMIT 1', [row.tenant_id, row.id]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ therapistName: row.therapist_name || '', rated: Boolean(rated) });
  } catch (error) { fail(res, error, 'consultation-rating:read'); }
});

router.post('/api/public/consultation-rating/:id', publicLimiter, async (req, res) => {
  try {
    const row = await ratableConsultation(req.params.id, req.query.t);
    await saveConsultationRating(pool, { tenantId: row.tenant_id, consultation: row, rating: req.body?.rating, comment: req.body?.comment });
    // A low rating is the lecturer's and the desk's to hear of at once.
    if (Number(req.body?.rating) <= 2 && row.therapist_id) {
      createNotification('consultation', '⚠️ تقييم منخفض لاستشارة', `${row.therapist_name || 'المحاضر'}: ${Number(req.body.rating)} من 5`, { consultationId: row.id }, row.tenant_id).catch(() => {});
    }
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'consultation-rating:save'); }
});

module.exports = router;
