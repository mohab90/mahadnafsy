'use strict';

// «اللايف سيشن» (8 Oct 2026): the lecturer's own lives and their «ابدأ» / «إنهاء»,
// the announcement to the lecturer and the course's clients, and the client's own
// join link that records they came (lib/liveStreams.js). Saving a live is
// routes/core/catalog.js.

const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');
const { pool } = require('../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { LIVE_STREAM_COLS, mapLiveStream } = require('../lib/mappers');
const { announceLiveStream, audienceOf, recordAttendance, validJoin } = require('../lib/liveStreams');

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
    const [[stream]] = await pool.query('SELECT id FROM live_streams WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (stream) await recordAttendance(pool, { tenantId: req.tenantId, streamId: stream.id, subscriberId: sub.id, via: 'site' });
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'join'); }
});

// «لايفاتي»: the lecturer's own lives.
router.get('/api/staff/me/live-streams', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
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
router.patch('/api/staff/me/live-streams/:id/status', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
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
    res.json({ ok: true, status: status.toLowerCase() });
  } catch (error) { fail(res, error, 'status'); }
});

module.exports = router;
