'use strict';

// «تذكير قبل الاستشارة» (25 Oct 2026): an hour before a confirmed consultation that has an hour, the lecturer and the client are each
// reminded on WhatsApp (and the lecturer in the portal), with the session's link. A sweep every ten minutes picks the sessions
// that start in the next 45–75 minutes; the outbox's dedupe key — which carries the session's own time, so a moved session is
// reminded again for its new time — makes each message go once however many sweeps see it.
//
// session_date holds the hour the customer picked as Cairo's wall clock (not an instant), so the window is built on Cairo's clock.

const outbox = require('./outbox');
const { ensureUpcomingMeetings } = require('./consultationMeetings');
const { insertNotification } = require('./notification');
const { toDialable } = require('./phoneNumber');
const { cairoClock } = require('./dates');
const { rescheduleRequestLink } = require('./consultationReschedule');

const AHEAD_FROM = 45;
const AHEAD_TO = 75;

/** 'YYYY-MM-DD HH:MM:SS' on Cairo's wall clock, `minutes` from now. */
function cairoWall(now, minutes) {
  const { date, time } = cairoClock(now);
  return new Date(Date.parse(`${date}T${time}:00Z`) + minutes * 60000).toISOString().slice(0, 19).replace('T', ' ');
}

const hour12 = hhmm => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
};

/** The messages one session is reminded with. */
function reminderMessages({ clientName, therapistName, at, meetingLink, changeLink }) {
  const when = hour12(at.slice(11, 16));
  const link = meetingLink ? `\nرابط الجلسة: ${meetingLink}` : '';
  return {
    lecturer: `⏰ *تذكير بجلسة*\nعندك جلسة مع ${clientName || 'العميل'} الساعة ${when} (بعد حوالي ساعة).${link}`,
    client: `⏰ تذكير بجلستك${therapistName ? ` مع د. ${therapistName}` : ''} النهارده الساعة ${when} (بعد حوالي ساعة).${link}\nلو مش هتقدر تحضر اطلب ميعاد تاني من هنا: ${changeLink}`,
  };
}

/** Remind every confirmed session starting in the next hour or so. Returns how many sessions were reminded. */
async function sendDueConsultationReminders(db, { tenantId, now = new Date() }) {
  // The meeting of each confirmed session of the next days is made first, so the reminder carries its link (lib/meetingProvider.js).
  await ensureUpcomingMeetings(db, { tenantId }).catch(() => 0);
  const [rows] = await db.query(
    `SELECT c.id, c.client_name, c.client_phone, c.meeting_link, DATE_FORMAT(c.session_date, '%Y-%m-%d %H:%i:00') AS at,
            t.name AS therapist_name, s.id AS staff_id, s.phone AS staff_phone
       FROM consultations c
       LEFT JOIN therapists t ON t.id = c.therapist_id AND t.tenant_id = c.tenant_id
       LEFT JOIN staff s ON s.id = t.staff_id AND s.tenant_id = t.tenant_id AND s.is_active = 1 AND s.deleted_at IS NULL
      WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.status = 'CONFIRMED' AND COALESCE(c.source, '') <> 'site_express'
        AND c.session_date >= ? AND c.session_date < ? AND TIME(c.session_date) <> '00:00:00'`,
    [tenantId, cairoWall(now, AHEAD_FROM), cairoWall(now, AHEAD_TO)]);
  let reminded = 0;
  for (const row of rows) {
    const stamp = row.at.replace(/\D/g, '');
    const messages = reminderMessages({
      clientName: row.client_name, therapistName: row.therapist_name, at: row.at, meetingLink: row.meeting_link,
      changeLink: rescheduleRequestLink(row.id),
    });
    const lecturer = toDialable(row.staff_phone);
    const queued = [];
    let lecturerFresh = false;
    if (lecturer) {
      lecturerFresh = Boolean(await outbox.enqueue({
        channel: 'whatsapp', recipient: lecturer, tenantId, refType: 'consultation', refId: row.id,
        dedupeKey: `consultation-reminder:${tenantId}:${row.id}:${stamp}:lecturer`, payload: { message: messages.lecturer, category: 'reminder' },
      }, db));
      queued.push(lecturerFresh);
    } else if (row.staff_id) {
      // No number on their file: the portal notice is the reminder, written once per session time.
      const [[seen]] = await db.query(
        "SELECT 1 AS ok FROM notifications WHERE tenant_id=? AND recipient_staff_id=? AND type='consultation' AND data_json LIKE ? LIMIT 1",
        [tenantId, row.staff_id, `%"reminder":"${row.id}:${stamp}"%`]);
      lecturerFresh = !seen;
    }
    // The portal notice goes out with the first WhatsApp reminder, not with every sweep that sees the session.
    if (row.staff_id && lecturerFresh) {
      await insertNotification(db, 'consultation', '⏰ جلسة بعد ساعة', messages.lecturer.replace(/\*/g, ''), { consultationId: row.id, reminder: `${row.id}:${stamp}` }, tenantId, row.staff_id);
    }
    const client = toDialable(row.client_phone);
    if (client) {
      queued.push(await outbox.enqueue({
        channel: 'whatsapp', recipient: client, tenantId, refType: 'consultation', refId: row.id,
        dedupeKey: `consultation-reminder:${tenantId}:${row.id}:${stamp}:client`, payload: { message: messages.client, category: 'reminder' },
      }, db));
    }
    if (queued.some(Boolean)) reminded += 1;
  }
  return reminded;
}

module.exports = { AHEAD_FROM, AHEAD_TO, cairoWall, reminderMessages, sendDueConsultationReminders };
