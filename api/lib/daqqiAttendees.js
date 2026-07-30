'use strict';

async function getDaqqiAttendees(db, tenantId, roundIds = []) {
  if (roundIds.length === 0) return [];
  const placeholders = roundIds.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT da.round_id, da.subscriber_id, s.name, s.phone, da.booked_at,
            da.attended_lectures,
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
       JOIN subscribers s
         ON s.id=da.subscriber_id AND s.tenant_id=da.tenant_id AND s.deleted_at IS NULL
      WHERE da.tenant_id=? AND da.round_id IN (${placeholders})`,
    [tenantId, ...roundIds]
  );
  return rows;
}

module.exports = { getDaqqiAttendees };
