-- Data cleanup 2026-06-20:
-- Some course cards showed a negative student count (e.g. "-3 طالب").
-- The student count must never be negative. Clamp any negative/NULL value to 0
-- at the source so all consumers (public client + admin) read clean data.
-- The application layer (api/lib/mappers.js + client CourseCard) also clamps
-- defensively; this migration fixes the persisted rows.

UPDATE courses
SET students = 0
WHERE students IS NULL OR students < 0;
