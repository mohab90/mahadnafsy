-- When a lecture's progress was last saved, so the time credited as watched
-- can grow only as fast as time actually passes (lib/learningProgress.js).
-- The browser reports how far into the video it is; jumping to the end and
-- reporting that used to finish the lecture, and enough of those the course.
--
-- Rollback: ALTER TABLE lecture_completions DROP COLUMN progress_saved_at;

ALTER TABLE lecture_completions
  ADD COLUMN IF NOT EXISTS progress_saved_at DATETIME NULL;
