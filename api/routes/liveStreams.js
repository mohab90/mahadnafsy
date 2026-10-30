'use strict';

// «اللايف سيشن» (8 Oct 2026): the lecturer's own lives and their «ابدأ» / «إنهاء»,
// the announcement to the lecturer and the course's clients, and the client's own
// join link that records they came (lib/liveStreams.js). Saving a live is
// routes/core/catalog.js.

const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');
const { pool } = require('../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { LIVE_STREAM_COLS, mapLiveStream } = require('../lib/mappers');
const { recordDeliveredLecture } = require('../lib/instructorPay');
const { PROVIDERS, integrationStatus, saveIntegration, createMeeting, deleteMeeting } = require('../lib/meetingProvider');
const { dateOnlyInTimeZone } = require('../lib/dates');
const { announceLiveStream, audienceOf, holdsALiveCourse, recordAttendance, validJoin } = require('../lib/liveStreams');

const fail = (res, error, where) => {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) logger.error(`[live-streams/${where}]`, error.message);
  res.status(statusCode).json({ error: statusCode < 500 ? error.message : 'Internal server error' });
};

// «إعادة الإشعار»: whoever was not told yet (a changed time counts as new).
router.post('/api/admin/live-streams/:id/announce', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  try {
    res.json({ ok: true, ...(await announceLiveStream(pool, { tenantId: req.tenantId, streamId: req.params.id })) });
  } catch (error) { fail(res, error, 'announce'); }
});

// Who the live is for, and who came.
router.get('/api/admin/live-streams/:id/audience', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
  try {
    const [[stream]] = await pool.query('SELECT * FROM live_streams WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!stream) return res.status(404).json({ error: 'اللايف مش موجود' });
    const audience = await audienceOf(pool, req.tenantId, stream);
    const [came] = await pool.query(
      `SELECT a.subscriber_id, a.joined_at, a.via, s.name, s.phone, s.client_code
         FROM live_stream_attendance a
         LEFT JOIN subscribers s ON s.id=a.subscriber_id AND s.tenant_id=a.tenant_id
        WHERE a.tenant_id=? AND a.stream_id=? ORDER BY a.joined_at`, [req.tenantId, stream.id]);
    res.json({
      invited: audience.clients.length, unpaid: audience.unpaid, attendedBefore: audience.attended, targeted: audience.courseIds.length > 0,
      announcedAt: stream.announced_at,
      attendees: came.map(row => ({ subscriberId: row.subscriber_id, name: row.name || '', phone: row.phone || '', clientCode: row.client_code || null, joinedAt: row.joined_at, via: row.via })),
    });
  } catch (error) { fail(res, error, 'audience'); }
});

// The client's own link from the WhatsApp message: count them in, then open the stream.
router.get('/api/live/:id/join', publicLimiter, async (req, res) => {
  try {
    const [[stream]] = await pool.query('SELECT id, tenant_id, stream_url, recording_url, status FROM live_streams WHERE id=? LIMIT 1', [req.params.id]);
    if (!stream) return res.status(404).send('<h3 dir="rtl">اللايف ده مش موجود</h3>');
    const subscriberId = String(req.query.s || '');
    if (subscriberId && validJoin(stream.id, subscriberId, req.query.t)) {
      await recordAttendance(pool, { tenantId: stream.tenant_id, streamId: stream.id, subscriberId, via: 'link' });
    }
    const target = stream.status === 'ENDED' && stream.recording_url ? stream.recording_url : stream.stream_url;
    if (!/^https?:\/\//i.test(String(target || ''))) return res.status(404).send('<h3 dir="rtl">رابط اللايف لسه متحطش</h3>');
    res.redirect(302, target);
  } catch (error) { fail(res, error, 'join-link'); }
});

// Joining from the client's page on the site.
router.post('/api/me/live-streams/:id/join', requireAuth, async (req, res) => {
  try {
    const sub = await resolveSubscriberRow(req, ['id']);
    if (!sub) return res.json({ ok: true });
    const [[stream]] = await pool.query('SELECT id, visibility, target_course_ids_json FROM live_streams WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    // Counted only when the client holds one of the courses the live is for (lib/liveStreams.js holdsALiveCourse).
    if (stream && await holdsALiveCourse(pool, { tenantId: req.tenantId, stream, subscriberId: sub.id })) {
      await recordAttendance(pool, { tenantId: req.tenantId, streamId: stream.id, subscriberId: sub.id, via: 'site' });
    }
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'join'); }
});

// «لايفاتي»: the lecturer's own lives.
router.get('/api/staff/me/live-streams', requireAuth, requireAdminOrStaff, requireAnyPermission('view_courses', 'use_lecturer_portal'), async (req, res) => {
  try {
    if (!req.staffRecord?.id) return res.json([]);
    const [rows] = await pool.query(
      `SELECT ${LIVE_STREAM_COLS}, started_at, ended_at,
              (SELECT COUNT(*) FROM live_stream_attendance a WHERE a.tenant_id=live_streams.tenant_id AND a.stream_id=live_streams.id) AS attendees
         FROM live_streams WHERE tenant_id=? AND instructor_id=? ORDER BY scheduled_at DESC LIMIT 100`,
      [req.tenantId, req.staffRecord.id]);
    res.json(rows.map(row => ({ ...mapLiveStream(row), startedAt: row.started_at, endedAt: row.ended_at, attendees: Number(row.attendees) || 0 })));
  } catch (error) { fail(res, error, 'mine'); }
});

// «ابدأ اللايف» / «إنهاء»: the lecturer's own live (or the administration).
router.patch('/api/staff/me/live-streams/:id/status', requireAuth, requireAdminOrStaff, requireAnyPermission('view_courses', 'use_lecturer_portal'), async (req, res) => {
  try {
    const status = String(req.body?.status || '').toUpperCase();
    if (!['LIVE', 'ENDED'].includes(status)) return res.status(400).json({ error: 'حالة غير معروفة' });
    const [[stream]] = await pool.query('SELECT id, instructor_id, status FROM live_streams WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!stream) return res.status(404).json({ error: 'اللايف مش موجود' });
    const manager = req.isSuperAdmin || ['admin', 'manager'].includes(String(req.staffRecord?.role || '').toLowerCase());
    if (!manager && String(stream.instructor_id || '') !== String(req.staffRecord?.id || '')) return res.status(403).json({ error: 'ده مش لايفك' });
    if (stream.status === 'ENDED') return res.status(409).json({ error: 'اللايف ده خلص' });
    const recording = status === 'ENDED' && /^https?:\/\//i.test(String(req.body?.recordingUrl || '')) ? String(req.body.recordingUrl).slice(0, 2000) : null;
    await pool.query(
      `UPDATE live_streams SET status=?, ${status === 'LIVE' ? 'started_at=COALESCE(started_at, NOW())' : 'ended_at=NOW()'}${recording ? ', recording_url=?' : ''}
        WHERE id=? AND tenant_id=?`,
      recording ? [status, recording, stream.id, req.tenantId] : [status, stream.id, req.tenantId]);
    // A live that ended is a lecture delivered: the lecturer's hour of live, at the price on their file (lib/instructorPay.js), for the
    // time it was set for. Recorded once per live (source_key) and left pending for the accounts team.
    if (status === 'ENDED' && stream.instructor_id) {
      const [[done]] = await pool.query('SELECT title, scheduled_at, duration_minutes, started_at, ended_at FROM live_streams WHERE id=? AND tenant_id=? LIMIT 1', [stream.id, req.tenantId]);
      const elapsed = done?.started_at && done?.ended_at ? (new Date(done.ended_at) - new Date(done.started_at)) / 3600000 : null;
      const hours = Number(done?.duration_minutes) > 0 ? Number(done.duration_minutes) / 60 : (elapsed > 0.1 ? elapsed : null);
      await recordDeliveredLecture(pool, {
        tenantId: req.tenantId, instructorId: stream.instructor_id, sourceKey: `livestream:${stream.id}`,
        date: dateOnlyInTimeZone(new Date(done?.scheduled_at || Date.now())), hours,
        note: `لايف — ${done?.title || ''}`.trim(), actor: req.staffRecord?.id || null,
      }).catch(error => logger.error('[live-streams/fee]', error.message));
    }
    res.json({ ok: true, status: status.toLowerCase() });
  } catch (error) { fail(res, error, 'status'); }
});

// «السيستم يربط API بزوم أو جوجل ميت»: the one video-meeting account of the institute (lib/meetingProvider.js). Only the owner's settings
// permission reads or changes it; the secret is sealed on save and never comes back.
router.get('/api/admin/meeting-integration', requireAuth, requireAdminOrStaff, requirePermission('manage_settings'), async (req, res) => {
  try { res.json(await integrationStatus(req.tenantId)); } catch (error) { fail(res, error, 'meeting-integration'); }
});

router.put('/api/admin/meeting-integration', requireAuth, requireAdminOrStaff, requirePermission('manage_settings'), async (req, res) => {
  try {
    const provider = String(req.body?.provider || '');
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'اختار Zoom أو Google Meet' });
    res.json(await saveIntegration(req.tenantId, req.body, { actorId: req.staffRecord?.id || null }));
  } catch (error) { fail(res, error, 'meeting-integration:save'); }
});

// «جرّب الربط»: makes a ten-minute meeting an hour from now, to see the keys work.
router.post('/api/admin/meeting-integration/test', requireAuth, requireAdminOrStaff, requirePermission('manage_settings'), async (req, res) => {
  try {
    const status = await integrationStatus(req.tenantId);
    if (!status.configured) return res.status(409).json({ error: 'الربط لسه مش مكتمل — كمّل البيانات واحفظ الأول' });
    const meeting = await createMeeting(req.tenantId, {
      topic: 'تجربة الربط', startLocal: new Date(Date.now() + 3600000).toISOString().slice(0, 19), timeZone: 'UTC', durationMinutes: 10,
    });
    deleteMeeting(req.tenantId, { provider: meeting.provider, meetingId: meeting.meetingId }).catch(() => false);
    res.json({ ok: true, provider: meeting.provider, joinUrl: meeting.joinUrl });
  } catch (error) {
    res.status(502).json({ error: `المزوّد رفض الطلب: ${String(error.message).slice(0, 200)}` });
  }
});

module.exports = router;
