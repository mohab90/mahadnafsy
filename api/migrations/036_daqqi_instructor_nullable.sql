-- 036_daqqi_instructor_nullable.sql
-- POST /api/admin/daqqi-rounds treats instructor, reception and start_date as
-- optional at creation time (the code writes NULL when they are not supplied:
-- `d.instructorId || null`, `d.receptionId || null`, `d.startDate || null`),
-- because a round can legitimately exist before its instructor/reception are
-- assigned or before it is scheduled (the display names are stored separately).
-- But the columns were declared NOT NULL, so creating such a round 500'd with
-- "Column '<x>' cannot be null". Widen the three columns to match the endpoint's
-- own optional-field contract. Widening only — existing rows keep their values.
-- Idempotent.
ALTER TABLE daqqi_rounds MODIFY COLUMN instructor_id VARCHAR(36) NULL DEFAULT NULL;
ALTER TABLE daqqi_rounds MODIFY COLUMN reception_id  VARCHAR(36) NULL DEFAULT NULL;
ALTER TABLE daqqi_rounds MODIFY COLUMN start_date    DATETIME    NULL DEFAULT NULL;
