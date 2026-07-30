'use strict';

const { pool } = require('./db');
const { resolveLectureAccess } = require('./learningAccess');

async function recordLectureProgress({
  tenantId, subscriberId, lectureId, progress, watchSeconds = 0,
}, db = pool) {
  const requestedProgress = Math.min(100, Math.max(0, Number(progress) || 0));
  const normalizedWatchSeconds = Math.min(86400, Math.max(0, Math.floor(Number(watchSeconds) || 0)));
  const access = await resolveLectureAccess({ tenantId, subscriberId, lectureId }, db);
  if (!access.accessible) {
    const error = new Error(`Lecture access denied: ${access.reason}`);
    error.statusCode = 403;
    throw error;
  }
  const durationSeconds = Math.max(0, Number(access.lecture.duration_seconds) || 0);
  const verifiedProgress = durationSeconds > 0
    ? Math.min(requestedProgress, Math.floor((normalizedWatchSeconds / durationSeconds) * 100))
    : requestedProgress;
  const normalizedProgress = requestedProgress >= 100 && durationSeconds > 0
    ? (normalizedWatchSeconds >= Math.ceil(durationSeconds * 0.8) ? 100 : Math.min(verifiedProgress, 99))
    : verifiedProgress;
  await db.query(
    `INSERT INTO lecture_completions
       (id,subscriber_id,lecture_id,course_id,progress_pct,watch_seconds,completed_at,tenant_id)
     VALUES (UUID(),?,?,?,?,?,IF(?=100,NOW(),NULL),?)
     ON DUPLICATE KEY UPDATE progress_pct=GREATEST(progress_pct,VALUES(progress_pct)),
       watch_seconds=GREATEST(watch_seconds,VALUES(watch_seconds)),
       completed_at=IF(GREATEST(progress_pct,VALUES(progress_pct))=100,COALESCE(completed_at,NOW()),completed_at),
       tenant_id=VALUES(tenant_id)`,
    [subscriberId, lectureId, access.lecture.course_id, normalizedProgress, normalizedWatchSeconds, normalizedProgress, tenantId]
  );
  const [[saved]] = await db.query(
    `SELECT progress_pct,watch_seconds,completed_at FROM lecture_completions
      WHERE tenant_id=? AND subscriber_id=? AND lecture_id=? LIMIT 1`,
    [tenantId, subscriberId, lectureId]
  );
  return {
    courseId: access.lecture.course_id,
    progress: Number(saved?.progress_pct ?? normalizedProgress),
    watchSeconds: Number(saved?.watch_seconds ?? normalizedWatchSeconds),
    completedAt: saved?.completed_at || null,
  };
}

module.exports = { recordLectureProgress };
