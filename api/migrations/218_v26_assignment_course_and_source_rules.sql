-- Which leads a rep receives, beside how many.
--
-- «في توزيع الداتا علي السيلز لازم كمان اقدر احدد كورس معين او كل الكورسات او
-- اكتر من كورس ينزل للسيلز كمان اقدر احدد المصدر اللى ينزل للسيلز».
--
-- Each is a JSON array. NULL (or an empty array) means every course, or every
-- source — what every rep receives today, so nothing changes until someone
-- picks. A course entry is a course id or 'bundle:<id>' for a track, the same
-- form leads.interested_course_ids_json holds. A lead no rep's rules take stays
-- unassigned, in «محلي جديد».

ALTER TABLE crm_assignment_members
  ADD COLUMN IF NOT EXISTS course_ids_json TEXT NULL DEFAULT NULL
    COMMENT 'Courses/tracks this rep receives. NULL = all.',
  ADD COLUMN IF NOT EXISTS sources_json TEXT NULL DEFAULT NULL
    COMMENT 'Lead sources this rep receives. NULL = all.';
