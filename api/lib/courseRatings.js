'use strict';

// A course's rating, from the ratings its own students gave.
//
// POST /api/courses/:id/rate takes a rating only from an enrolled student, but
// the rating stays when the enrolment goes — refunded, revoked — and the
// average counted it still. «Verified» here is a rater who holds the course now
// (active, paused or completed): the figure the course cards show beside
// «تقييمات حقيقية», and the course page's.

const VERIFIED_SQL = `EXISTS (SELECT 1 FROM enrollments e
   WHERE e.tenant_id=r.tenant_id AND e.subscriber_id=r.subscriber_id AND e.course_id=r.course_id
     AND e.revoked_at IS NULL AND e.status IN ('active','paused','completed'))`;

const shape = row => ({ avg: Math.round((Number(row?.avg) || 0) * 10) / 10, count: Number(row?.cnt) || 0 });

/** One course's verified average and count. */
async function courseRating(db, { tenantId, courseId }) {
  const [[row]] = await db.query(
    `SELECT AVG(r.rating) AS avg, COUNT(*) AS cnt FROM course_ratings r
      WHERE r.course_id=? AND r.tenant_id=? AND ${VERIFIED_SQL}`, [courseId, tenantId]);
  return shape(row);
}

/** Every rated, published course of the institute: { [courseId]: { avg, count } }. */
async function courseRatings(db, { tenantId }) {
  const [rows] = await db.query(
    `SELECT r.course_id, AVG(r.rating) AS avg, COUNT(*) AS cnt
       FROM course_ratings r
       JOIN courses c ON c.id=r.course_id AND c.tenant_id=r.tenant_id AND c.deleted_at IS NULL AND c.is_published=1
      WHERE r.tenant_id=? AND ${VERIFIED_SQL}
      GROUP BY r.course_id`, [tenantId]);
  return Object.fromEntries(rows.map(row => [row.course_id, shape(row)]));
}

module.exports = { courseRating, courseRatings, VERIFIED_SQL };
