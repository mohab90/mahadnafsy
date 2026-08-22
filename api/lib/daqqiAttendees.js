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
                 AND (p.course_id=dr.course_id OR p.course_id IS NULL)
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
