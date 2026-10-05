'use strict';

const { pool } = require('./db');
const { resolveLectureAccess } = require('./learningAccess');

// The browser saves every 15 seconds of playback; these bound what one save
// may add. A first save may credit a minute and a half — a player that
// started where it left off last time on another device, say.
const FIRST_SAVE_SECONDS = 90;
const MAX_SPEED = 2;
const SLACK_SECONDS = 30;

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
  // What the browser says is how far into the video it is, and a seek moves
  // that as far as anyone likes: «watched 80%» was one request away. The time
  // credited grows only as fast as time passes since the last save — twice
  // as fast, for a video played at 2x, plus half a minute of slack — so the
  // lecture is finished by watching it, however the player reports.
  const [previousRows] = await db.query(
    `SELECT watch_seconds, TIMESTAMPDIFF(SECOND, progress_saved_at, NOW()) AS since
       FROM lecture_completions WHERE tenant_id=? AND subscriber_id=? AND lecture_id=? LIMIT 1`,
    [tenantId, subscriberId, lectureId]);
  const previous = Array.isArray(previousRows) ? previousRows[0] : null;
  const allowed = !previous ? FIRST_SAVE_SECONDS
    // Saved before this was kept: its figure stands, the next save is measured.
    : previous.since === null ? Infinity
      : Number(previous.watch_seconds || 0) + Math.max(0, Number(previous.since)) * MAX_SPEED + SLACK_SECONDS;
  const creditedSeconds = Math.min(normalizedWatchSeconds, allowed);
  const verifiedProgress = durationSeconds > 0
    ? Math.min(requestedProgress, Math.floor((creditedSeconds / durationSeconds) * 100))
    : requestedProgress;
  const normalizedProgress = requestedProgress >= 100 && durationSeconds > 0
    ? (creditedSeconds >= Math.ceil(durationSeconds * 0.8) ? 100 : Math.min(verifiedProgress, 99))
    : verifiedProgress;
  await db.query(
    `INSERT INTO lecture_completions
       (id,subscriber_id,lecture_id,course_id,progress_pct,watch_seconds,completed_at,tenant_id,progress_saved_at)
     VALUES (UUID(),?,?,?,?,?,IF(?=100,NOW(),NULL),?,NOW())
     ON DUPLICATE KEY UPDATE progress_pct=GREATEST(progress_pct,VALUES(progress_pct)),
       watch_seconds=GREATEST(watch_seconds,VALUES(watch_seconds)),
       completed_at=IF(GREATEST(progress_pct,VALUES(progress_pct))=100,COALESCE(completed_at,NOW()),completed_at),
       progress_saved_at=NOW(),
       tenant_id=VALUES(tenant_id)`,
    [subscriberId, lectureId, access.lecture.course_id, normalizedProgress, creditedSeconds, normalizedProgress, tenantId]
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

module.exports = { recordLectureProgress, FIRST_SAVE_SECONDS, MAX_SPEED, SLACK_SECONDS };
