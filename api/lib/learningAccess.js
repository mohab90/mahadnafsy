'use strict';

const { pool } = require('./db');

async function resolveLectureAccess({ tenantId, subscriberId, lectureId }, db = pool) {
  const [[lecture]] = await db.query(
    `SELECT cl.id,cl.course_id,cl.sort_order,cl.drip_unlock_days,cl.video_url,cl.duration_seconds,
            COALESCE(cc.sort_order,999999) AS chapter_sort,
            e.enrolled_at,e.access_type,e.lecture_limit,e.expiry_date
       FROM course_lectures cl
       JOIN courses c ON c.id=cl.course_id AND c.tenant_id=? AND c.deleted_at IS NULL
       LEFT JOIN course_chapters cc ON cc.id=cl.chapter_id
       LEFT JOIN enrollments e ON e.course_id=cl.course_id AND e.subscriber_id=?
         AND e.tenant_id=? AND e.status='active'
      WHERE cl.id=? AND cl.is_published=1 LIMIT 1`,
    [tenantId, subscriberId, tenantId, lectureId]
  );
  if (!lecture) return { accessible: false, reason: 'not_found' };
  if (!lecture.enrolled_at) return { accessible: false, reason: 'not_enrolled', lecture };

  // Access runs out when the course says it does. NULL is unlimited, which
  // is what every enrolment made before durations existed carries — so no
  // existing customer loses anything.
  if (lecture.expiry_date) {
    const expiresAt = new Date(lecture.expiry_date);
    if (Number.isFinite(expiresAt.getTime()) && Date.now() > expiresAt.getTime()) {
      return { accessible: false, reason: 'access_expired', expiresAt: expiresAt.toISOString(), lecture };
    }
  }

  if (lecture.access_type === 'limited') {
    const limit = Math.max(1, Math.floor(Number(lecture.lecture_limit) || 1));
    const [[positionRow]] = await db.query(
      `SELECT COUNT(*) AS pos
         FROM course_lectures cl
         LEFT JOIN course_chapters cc ON cc.id=cl.chapter_id AND cc.course_id=cl.course_id
        WHERE cl.course_id=? AND cl.is_published=1 AND (COALESCE(cc.sort_order,999999) < ?
          OR (COALESCE(cc.sort_order,999999)=? AND cl.sort_order < ?))`,
      [lecture.course_id, lecture.chapter_sort, lecture.chapter_sort, lecture.sort_order]
    );
    const position = Number(positionRow?.pos || 0);
    if (position >= limit) {
      return { accessible: false, reason: 'access_limited', allowed: limit, position: position + 1, lecture };
    }
  }

  const dripDays = Math.max(0, Number(lecture.drip_unlock_days) || 0);
  if (dripDays) {
    const unlockAt = new Date(new Date(lecture.enrolled_at).getTime() + dripDays * 86400000);
    if (Number.isFinite(unlockAt.getTime()) && Date.now() < unlockAt.getTime()) {
      return { accessible: false, reason: 'drip_locked', unlocksAt: unlockAt.toISOString(), lecture };
    }
  }
  return { accessible: true, lecture };
}

module.exports = { resolveLectureAccess };
