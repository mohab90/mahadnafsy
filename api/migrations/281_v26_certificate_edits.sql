-- What the desk may change on one institute certificate before it is printed.
--
-- «محتاجين يكون في زر تعديل للاسم او المدة او اي حاجه تخص الشهادة» (14 Oct 2026). The
-- certificate prints the client's English name, the course's English title, its duration
-- and the trainer — each from its own source (the client's file, the course). A change made
-- here belongs to THIS certificate only: NULL means «as the sources say», so editing one
-- certificate never rewrites the client or the course.
--
-- Rollback:
--   ALTER TABLE course_completions DROP COLUMN cert_name_en, DROP COLUMN cert_course_en,
--     DROP COLUMN cert_duration, DROP COLUMN cert_trainer;

ALTER TABLE course_completions
  ADD COLUMN IF NOT EXISTS cert_name_en VARCHAR(160) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cert_course_en VARCHAR(255) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cert_duration VARCHAR(80) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cert_trainer VARCHAR(160) NULL DEFAULT NULL;
