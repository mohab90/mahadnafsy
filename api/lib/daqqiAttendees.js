'use strict';

// Attendee rows are operational history: a booking that happened, and the
// attendance recorded against it. Archiving a client (DELETE
// /api/admin/subscribers/:id sets is_active=0 + deleted_at) must NOT retract
// that history — daqqi-rounds.js already refuses to delete a round that has
// attendance, and refuses to drop an attendee who has any. Archiving was a side
// door to exactly that erasure: an inner join on `s.deleted_at IS NULL` removed
// the client from every round they had attended, so per-round counts and every
// historical report silently under-reported the moment anyone was archived.
//
// Hence the LEFT JOIN with no deleted_at condition: the row survives archival,
// and even hard deletion of the subscriber, falling back to the name/phone
// snapshot daqqi_attendees already stores. Callers get `archived` so they can
// label the client instead of losing them.
//
// Outbound messaging is deliberately NOT filtered here. lib/scheduledJobHandlers.js
// narrows recipients at the send instead, so that excluding an archived client
// from a WhatsApp reminder cannot quietly remove them from the counts as well.
// What a client paid *for this round* is the money tied to its course, either
// directly or through a bundle containing it. This read used to ask for
// "p.course_id=dr.course_id OR p.course_id IS NULL", and course_id is NULL for
// every non-course payment — certificate, consultation, book, carneh — and for
// every bundle payment. So a client's 1,500 certificate fee was counted as money
// paid for the round, once per round they were booked on, and the monthly
// attendance report overstated Dokki revenue by the same amount again. The
// booking INSERT in daqqi-rounds.js always had the strict predicate; only the
// read carried a looser copy.
async function getDaqqiAttendees(db, tenantId, roundIds = []) {
  if (roundIds.length === 0) return [];
  const placeholders = roundIds.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT da.round_id, da.subscriber_id,
            COALESCE(s.name, da.name) AS name,
            COALESCE(s.phone, da.phone) AS phone,
            da.booked_at,
            da.attended_lectures,
            (s.id IS NULL OR s.deleted_at IS NOT NULL) AS archived,
            COALESCE((
              SELECT SUM(p.amount_egp)
                FROM payments p
               WHERE p.tenant_id=da.tenant_id
                 AND p.subscriber_id=da.subscriber_id
                 AND p.status='paid'
                 AND p.deleted_at IS NULL
                 AND (p.course_id=dr.course_id OR EXISTS (
                       SELECT 1 FROM bundle_courses bc
                        WHERE bc.tenant_id=p.tenant_id
                          AND bc.bundle_id=p.bundle_id
                          AND bc.course_id=dr.course_id
                     ))
            ), da.amount_paid, 0) AS amount_paid
       FROM daqqi_attendees da
       JOIN daqqi_rounds dr
         ON dr.id=da.round_id AND dr.tenant_id=da.tenant_id
       LEFT JOIN subscribers s
         ON s.id=da.subscriber_id AND s.tenant_id=da.tenant_id
      WHERE da.tenant_id=? AND da.round_id IN (${placeholders})`,
    [tenantId, ...roundIds]
  );
  return rows;
}

module.exports = { getDaqqiAttendees };
