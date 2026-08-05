-- 189_v25_interview_rating.sql
-- "الانترفيوهات" (Interviews) section: staff need to record a structured
-- 1-5 rating at/after the interview stage, not just free-text stage_notes.
-- Idempotent + additive (MariaDB 11.8).

-- Range (1-5) is validated in api/routes/hr/recruiting.js rather than a DB
-- CHECK constraint — this codebase's migrations don't yet have a confirmed
-- ALTER TABLE ADD CONSTRAINT IF NOT EXISTS pattern in production, and this
-- one field doesn't warrant being the first to find out the hard way.
ALTER TABLE IF EXISTS job_applicants
  ADD COLUMN IF NOT EXISTS interview_rating TINYINT DEFAULT NULL COMMENT '1-5, set at or after the interview stage';
