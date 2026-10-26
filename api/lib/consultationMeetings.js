'use strict';

// The meeting of a confirmed consultation is made by the system, not typed by the lecturer (lib/meetingProvider.js): the client gets the
// join link, the lecturer the host link behind «ابدأ الجلسة». Made when the session is within a few days — never for a request nobody has
// paid for — and again, from scratch, when the client's session is moved.

const logger = require('./logger');
const { createMeeting, deleteMeeting } = require('./meetingProvider');

const AHEAD_DAYS = 3;

const wall = value => String(value || '').replace(' ', 'T').slice(0, 19);

/**
 * Make the meeting of one consultation if the system should and it has none.
 * @returns {Promise<{meetingLink:string, hostLink:string}|null>} null when nothing was made (no integration, not confirmed, no hour)
 */
async function ensureConsultationMeeting(db, { tenantId, consultationId }, deps = {}) {
  const [[row]] = await db.query(
    `SELECT c.id, c.status, c.meeting_link, c.host_link, c.meeting_id, c.session_duration_minutes, c.client_name,
            DATE_FORMAT(c.session_date, '%Y-%m-%dT%H:%i:%s') AS at, t.name AS therapist_name, t.session_duration_minutes AS default_minutes
       FROM consultations c LEFT JOIN therapists t ON t.id=c.therapist_id AND t.tenant_id=c.tenant_id
      WHERE c.id=? AND c.tenant_id=? AND c.deleted_at IS NULL LIMIT 1`, [consultationId, tenantId]);
  if (!row || row.status !== 'CONFIRMED' || !row.at || /T00:00:00$/.test(row.at)) return null;
  if (row.meeting_id) return { meetingLink: row.meeting_link, hostLink: row.host_link };
  const meeting = await createMeeting(tenantId, {
    topic: `جلسة استشارة${row.therapist_name ? ` — د. ${row.therapist_name}` : ''}`,
    startLocal: wall(row.at), timeZone: 'Africa/Cairo',
    durationMinutes: Number(row.session_duration_minutes) || Number(row.default_minutes) || 60,
  }, deps);
  if (!meeting?.joinUrl) return null;
  await db.query(
    'UPDATE consultations SET meeting_link=?, host_link=?, meeting_id=?, meeting_provider=? WHERE id=? AND tenant_id=? AND meeting_id IS NULL',
    [meeting.joinUrl, meeting.hostUrl || null, meeting.meetingId, meeting.provider, row.id, tenantId]);
  return { meetingLink: meeting.joinUrl, hostLink: meeting.hostUrl || meeting.joinUrl };
}

/** The confirmed sessions of the next days that have no meeting yet — the reminders' sweep calls this first. */
async function ensureUpcomingMeetings(db, { tenantId }, deps = {}) {
  const [rows] = await db.query(
    `SELECT id FROM consultations
      WHERE tenant_id=? AND deleted_at IS NULL AND status='CONFIRMED' AND meeting_id IS NULL AND COALESCE(source, '') <> 'site_express'
        AND session_date >= NOW() - INTERVAL 1 HOUR AND session_date < NOW() + INTERVAL ${AHEAD_DAYS} DAY AND TIME(session_date) <> '00:00:00'
      ORDER BY session_date LIMIT 50`, [tenantId]);
  let made = 0;
  for (const row of rows) {
    try {
      if (await ensureConsultationMeeting(db, { tenantId, consultationId: row.id }, deps)) made += 1;
    } catch (error) {
      logger.error('[consultation-meetings]', error.message);
      break; // the provider is down or refusing the keys: one error per sweep, not one per session
    }
  }
  return made;
}

/** The session was moved: the old meeting goes, and the next sweep (or «ابدأ») makes one for the new hour. */
async function resetConsultationMeeting(db, { tenantId, consultationId }, deps = {}) {
  const [[row]] = await db.query('SELECT meeting_id, meeting_provider FROM consultations WHERE id=? AND tenant_id=? LIMIT 1', [consultationId, tenantId]);
  if (!row?.meeting_id) return false;
  await deleteMeeting(tenantId, { provider: row.meeting_provider, meetingId: row.meeting_id }, deps).catch(error => logger.warn('[consultation-meetings] delete', { error: error.message }));
  await db.query('UPDATE consultations SET meeting_link=NULL, host_link=NULL, meeting_id=NULL, meeting_provider=NULL WHERE id=? AND tenant_id=?', [consultationId, tenantId]);
  return true;
}

module.exports = { AHEAD_DAYS, ensureConsultationMeeting, ensureUpcomingMeetings, resetConsultationMeeting };
