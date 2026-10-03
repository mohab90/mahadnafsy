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
async function getDaqqiAttendees(db, tenantId, roundIds = [], { withRevenue = false } = {}) {
  if (roundIds.length === 0) return [];
  const placeholders = roundIds.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT da.round_id, da.subscriber_id, dr.course_id,
            COALESCE(s.name, da.name) AS name,
            COALESCE(s.phone, da.phone) AS phone,
            da.booked_at,
            da.attended_lectures,
            (s.id IS NULL OR s.deleted_at IS NOT NULL) AS archived,
            -- The figure stored at booking (da.amount_paid) is only a fallback for a
            -- client with no payment row at all for this course — a sheet import. Once
            -- any row exists, even a refunded or deleted one, the payments decide: the
            -- stored figure kept reading «900» for a client whose 900 had been refunded.
            COALESCE((
              SELECT SUM(COALESCE(p.amount_egp, p.amount))
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
            ), CASE WHEN EXISTS (
                 SELECT 1 FROM payments p
                  WHERE p.tenant_id=da.tenant_id
                    AND p.subscriber_id=da.subscriber_id
                    AND (p.course_id=dr.course_id OR EXISTS (
                          SELECT 1 FROM bundle_courses bc
                           WHERE bc.tenant_id=p.tenant_id
                             AND bc.bundle_id=p.bundle_id
                             AND bc.course_id=dr.course_id
                        ))
               ) THEN 0 ELSE da.amount_paid END, 0) AS amount_paid,
            ${withRevenue ? REVENUE_SQL : ''}
            -- Recorded for this round's course and not yet approved. The desk's
            -- own payments are PENDING until accounts approve them, so the roster
            -- read «المدفوع 0» for every client who had handed cash over.
            COALESCE((
              SELECT SUM(COALESCE(p.amount_egp, p.amount))
                FROM payments p
               WHERE p.tenant_id=da.tenant_id
                 AND p.subscriber_id=da.subscriber_id
                 AND p.status='pending'
                 AND p.deleted_at IS NULL
                 AND (p.course_id=dr.course_id OR EXISTS (
                       SELECT 1 FROM bundle_courses bc
                        WHERE bc.tenant_id=p.tenant_id
                          AND bc.bundle_id=p.bundle_id
                          AND bc.course_id=dr.course_id
                     ))
            ), 0) AS pending_amount,
            -- Collected course money that names no course and no track (old rows,
            -- imports). It cannot be tied to a round without guessing, so it is
            -- shown apart rather than counted or dropped.
            COALESCE((
              SELECT SUM(COALESCE(p.amount_egp, p.amount))
                FROM payments p
               WHERE p.tenant_id=da.tenant_id
                 AND p.subscriber_id=da.subscriber_id
                 AND p.status='paid'
                 AND p.deleted_at IS NULL
                 AND p.amount > 0
                 AND p.course_id IS NULL AND p.bundle_id IS NULL
                 AND p.payment_type IN ('COURSE','OTHER')
            ), 0) AS unlinked_amount,
            -- «مدفوع قبل السيستم»: money the client paid for THIS course before the
            -- system existed, kept in subscribers.crm_json.priorPaid keyed by course
            -- id (sheet import, collection import). It is real money for this round
            -- but it was never a payment row, so the roster could not see it and read
            -- «المدفوع 0» for 1,609 of the 1,919 Dokki clients. Returned apart so the
            -- revenue figures, which are period collections, do not count it.
            COALESCE(CASE WHEN s.crm_json IS NOT NULL AND JSON_VALID(s.crm_json)
              THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(s.crm_json,
                     CONCAT('$.priorPaid."', REPLACE(dr.course_id, '"', ''), '"'))) AS DECIMAL(14,2))
              END, 0) AS prior_paid
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

// What this round earned, for the reports — only asked for by the ones that sum money over
// rounds, since it is one more lookup per client on every call. Declared below the function
// that uses it: the money counted for the round is the first thing in the query and this is not.
const REVENUE_SQL = `-- What this round earned, for the reports. amount_paid above is what the CLIENT
            -- has paid toward the course, so a track's money shows whole on each of its
            -- courses' rounds — right for the client's page, and summed over rounds it
            -- counts the same payment three times. Here a payment that names a course is
            -- that course's, and one that names only a track is split across its courses.
            COALESCE((
              SELECT SUM(COALESCE(p.amount_egp, p.amount) / CASE
                       WHEN p.course_id IS NULL AND p.bundle_id IS NOT NULL
                       THEN GREATEST(1, (SELECT COUNT(*) FROM bundle_courses b2
                                          WHERE b2.tenant_id=p.tenant_id AND b2.bundle_id=p.bundle_id))
                       ELSE 1 END)
                FROM payments p
               WHERE p.tenant_id=da.tenant_id
                 AND p.subscriber_id=da.subscriber_id
                 AND p.status='paid'
                 AND p.deleted_at IS NULL
                 AND (p.course_id=dr.course_id OR (p.course_id IS NULL AND EXISTS (
                       SELECT 1 FROM bundle_courses bc
                        WHERE bc.tenant_id=p.tenant_id
                          AND bc.bundle_id=p.bundle_id
                          AND bc.course_id=dr.course_id
                     )))
            ), CASE WHEN EXISTS (
                 SELECT 1 FROM payments p
                  WHERE p.tenant_id=da.tenant_id
                    AND p.subscriber_id=da.subscriber_id
                    AND (p.course_id=dr.course_id OR EXISTS (
                          SELECT 1 FROM bundle_courses bc
                           WHERE bc.tenant_id=p.tenant_id
                             AND bc.bundle_id=p.bundle_id
                             AND bc.course_id=dr.course_id
                        ))
               ) THEN 0 ELSE da.amount_paid END, 0) AS revenue_share,`;

module.exports = { getDaqqiAttendees };
