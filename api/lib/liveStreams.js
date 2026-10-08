'use strict';

/**
 * «لما نضيف محاضرة لايف علي السيستم مع دكتور لازم يروحله اشعار ويروح لكل العملاء
 * اللى مشتركه في نفس الكورس اشعار ان في لايف قريب بتاريخ كذا مع دكتور كذا ,, بس
 * شرط ان العملاء دول خلصوا فلوسهم او 90 % وشرط انهم محضروش اللايف قبل كدا» (8 Oct 2026).
 *
 * The audience of a live is the clients of the courses it targets who have paid
 * 90% of the course (lib/coursePaid.js — the certificate's rule) and did not join
 * a live of that course before. Each gets a WhatsApp message with their own link:
 * it records that they joined (live_stream_attendance) and opens the stream, so
 * «حضر قبل كده» is known for a Dokki client with no account on the site too.
 */

const { createHash, createHmac } = require('crypto');
const outbox = require('./outbox');
const { insertNotification } = require('./notification');
const { hasPaidForCourse } = require('./coursePaid');
const { uuidv4 } = require('./id');

const SITE = () => String(process.env.CLIENT_URL || 'https://mahadnafsy.com').replace(/\/+$/, '');
const secret = () => process.env.JWT_SECRET || process.env.AUTH_SECRET || 'mahad-live';
const tryJson = (value, fallback) => { try { return JSON.parse(value || ''); } catch { return fallback; } };

/** A client's own link to a live: who joined is known without an account. */
function joinToken(streamId, subscriberId) {
  return createHmac('sha256', secret()).update(`${streamId}.${subscriberId}`).digest('hex').slice(0, 32);
}
const joinLink = (streamId, subscriberId) =>
  `${SITE()}/api/live/${encodeURIComponent(streamId)}/join?s=${encodeURIComponent(subscriberId)}&t=${joinToken(streamId, subscriberId)}`;
const validJoin = (streamId, subscriberId, token) => {
  const expected = joinToken(streamId, subscriberId);
  const a = createHash('sha256').update(String(token || '')).digest();
  const b = createHash('sha256').update(expected).digest();
  return a.equals(b);
};

const courseIdsOf = stream => (String(stream.visibility || '').toUpperCase() === 'COURSE_SUBSCRIBERS'
  ? tryJson(stream.target_course_ids_json, []).map(String).filter(Boolean)
  : []);

/** The clients a live is for, and why the others were left out. */
async function audienceOf(db, tenantId, stream) {
  const courseIds = courseIdsOf(stream);
  if (!courseIds.length) return { clients: [], unpaid: 0, attended: 0, courseIds };
  const marks = courseIds.map(() => '?').join(',');
  // Everyone who holds the course: its own money, a track that holds it, an
  // enrolment, or a seat in a Dokki round of it.
  const [rows] = await db.query(
    `SELECT DISTINCT s.id, s.name, s.phone, s.email, x.course_id FROM (
        SELECT p.subscriber_id, p.course_id FROM payments p
         WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND p.course_id IN (${marks})
        UNION SELECT p.subscriber_id, bc.course_id FROM payments p
          JOIN bundle_courses bc ON bc.bundle_id=p.bundle_id AND bc.tenant_id=p.tenant_id
         WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND bc.course_id IN (${marks})
        UNION SELECT e.subscriber_id, e.course_id FROM enrollments e
         WHERE e.tenant_id=? AND e.status='active' AND e.course_id IN (${marks})
        UNION SELECT da.subscriber_id, dr.course_id FROM daqqi_attendees da
          JOIN daqqi_rounds dr ON dr.id=da.round_id AND dr.tenant_id=da.tenant_id
         WHERE da.tenant_id=? AND dr.course_id IN (${marks})
      ) x
      JOIN subscribers s ON s.id=x.subscriber_id AND s.tenant_id=? AND s.deleted_at IS NULL`,
    [tenantId, ...courseIds, tenantId, ...courseIds, tenantId, ...courseIds, tenantId, ...courseIds, tenantId]);
  // Who joined a live of any of these courses before (another live than this one).
  const [joined] = await db.query(
    `SELECT DISTINCT a.subscriber_id, ls.target_course_ids_json FROM live_stream_attendance a
       JOIN live_streams ls ON ls.id=a.stream_id AND ls.tenant_id=a.tenant_id
      WHERE a.tenant_id=? AND a.stream_id<>?`, [tenantId, stream.id]);
  const attendedCourse = new Set();
  for (const row of joined) {
    for (const courseId of tryJson(row.target_course_ids_json, [])) attendedCourse.add(`${row.subscriber_id}|${courseId}`);
  }
  const clients = new Map();
  let unpaid = 0;
  let attended = 0;
  for (const row of rows) {
    if (clients.has(row.id)) continue;
    if (attendedCourse.has(`${row.id}|${row.course_id}`)) { attended += 1; continue; }
    if (!(await hasPaidForCourse(db, { tenantId, subscriberId: row.id, courseId: row.course_id }))) { unpaid += 1; continue; }
    clients.set(row.id, { id: row.id, name: row.name, phone: row.phone, email: row.email });
  }
  return { clients: [...clients.values()], unpaid, attended, courseIds };
}

const whenOf = at => new Date(at).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Cairo' });

/**
 * Tell the lecturer and the live's audience. Each message has a dedupe key, so
 * announcing again (the desk's «إعادة الإشعار», or a changed time) reaches only
 * whoever was not told yet. Returns who was told.
 */
async function announceLiveStream(db, { tenantId, streamId }) {
  const [[stream]] = await db.query('SELECT * FROM live_streams WHERE id=? AND tenant_id=? LIMIT 1', [streamId, tenantId]);
  if (!stream) { const error = new Error('اللايف مش موجود'); error.statusCode = 404; throw error; }
  const when = whenOf(stream.scheduled_at);
  const lecturer = stream.instructor_name || 'المحاضر';
  const stamp = new Date(stream.scheduled_at).getTime();
  let instructorTold = false;
  if (stream.instructor_id) {
    const [[staff]] = await db.query('SELECT id, name, phone FROM staff WHERE id=? AND tenant_id=? LIMIT 1', [stream.instructor_id, tenantId]);
    if (staff) {
      await insertNotification(db, 'live', '🎥 عندك لايف', `«${stream.title}» — ${when}. افتحه من «لايفاتي» في بوابة المحاضر.`,
        { streamId: stream.id }, tenantId, staff.id);
      if (staff.phone) {
        await outbox.enqueue({
          channel: 'whatsapp', recipient: staff.phone, tenantId, refType: 'live_stream', refId: stream.id,
          dedupeKey: `live:${tenantId}:${stream.id}:${stamp}:lecturer`,
          payload: { message: `أهلاً د. ${staff.name} 🎥\nعندك لايف «${stream.title}»\nالموعد: ${when}\nرابط البث: ${stream.stream_url}`, category: 'reminder' },
        }, db);
      }
      instructorTold = true;
    }
  }
  const audience = await audienceOf(db, tenantId, stream);
  const reminderAt = stamp - 2 * 3600 * 1000;
  for (const client of audience.clients) {
    if (!client.phone) continue;
    const link = joinLink(stream.id, client.id);
    await outbox.enqueue({
      channel: 'whatsapp', recipient: client.phone, tenantId, refType: 'live_stream', refId: stream.id,
      dedupeKey: `live:${tenantId}:${stream.id}:${stamp}:${client.id}`,
      payload: { message: `أهلاً ${client.name || ''} 👋\nفي لايف قريب «${stream.title}» مع ${lecturer}\nالموعد: ${when}\nرابط الدخول الخاص بيك: ${link}\n— معهد الدراسات النفسية`, category: 'reminder' },
    }, db);
    if (reminderAt > Date.now()) {
      await outbox.enqueue({
        channel: 'whatsapp', recipient: client.phone, tenantId, refType: 'live_stream', refId: stream.id, sendAt: new Date(reminderAt),
        dedupeKey: `live:${tenantId}:${stream.id}:${stamp}:${client.id}:reminder`,
        payload: { message: `⏰ اللايف «${stream.title}» مع ${lecturer} بعد ساعتين\nادخل من هنا: ${link}`, category: 'reminder' },
      }, db);
    }
  }
  await db.query('UPDATE live_streams SET announced_at=NOW() WHERE id=? AND tenant_id=?', [stream.id, tenantId]);
  return { instructorTold, clients: audience.clients.length, noPhone: audience.clients.filter(c => !c.phone).length, unpaid: audience.unpaid, attended: audience.attended, targeted: audience.courseIds.length > 0 };
}

/** A client joined — through their link or from the site. Once per live. */
async function recordAttendance(db, { tenantId, streamId, subscriberId, via = 'link' }) {
  await db.query(
    'INSERT IGNORE INTO live_stream_attendance (id, tenant_id, stream_id, subscriber_id, via) VALUES (?,?,?,?,?)',
    [uuidv4(), tenantId, streamId, subscriberId, via]);
}

module.exports = { announceLiveStream, audienceOf, joinLink, joinToken, recordAttendance, validJoin };
