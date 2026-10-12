-- طلبات الانضمام: which form, which branch, the lecturer's answers and the first call.
--
-- «في طلبات الانضمام في الموارد البشرية لازم تبقي عارف ان في طلبات انضمام موظف
-- وفي محاضر لازم تفرق بيينهم بشكل كبير … في صفحه تسجيل محاضر جديد محتاجين نزود
-- سوال صح او غلط هل عملت محاضر من قبل ,, وسوال هل عملت في جلسات نفسيه مع عملاء
-- من قبل … اتاكد ان طلبات الانضمام للدقي والانترفيو للدقي بيظهر لنشوي مدير الدقي
-- … لازم يكون في زر تقييم اول مكالمه» (12 Oct 2026).
--
-- source_form  The public page the application came through: 'teaching' (/join,
--              محاضر / مستشار) or 'staff' (/join-us, موظف). `type` alone was not
--              reliable — the route filed anything without a recognised type as
--              INSTRUCTOR, so an employee's application could land in the
--              lecturers' list.
-- branch       The branch the applicant chose (branch_key, lower-case as the forms
--              send it). It lived only on the converted job_applicants row, so the
--              Dokki manager's list could not be narrowed without that join.
-- lectured_before / sessions_before
--              The two yes/no questions on the lecturer form.
-- programs_json / programs_other
--              The institute's programmes the lecturer can teach (published
--              courses: [{"id","title"}]) and anything else they teach, free text.
-- first_call_* «تقييم أول مكالمة»: 1–5, quick tags, notes, who and when.
--
-- recruitment_notes gains kind 'first_call' so the rating lands in the
-- application's history beside the calls and decisions.
--
-- The status default is restated as NEW: the column always defaulted to NEW but
-- the creation path stamped REVIEWED (routes/hr/talent.js), which is the bug the
-- owner saw as «لازم اي طلب بيكون جديد مش قيد المراجعه».
--
-- Rollback:
--   ALTER TABLE join_us_applications
--     DROP COLUMN first_call_by_name, DROP COLUMN first_call_by, DROP COLUMN first_call_at,
--     DROP COLUMN first_call_notes, DROP COLUMN first_call_tags, DROP COLUMN first_call_rating,
--     DROP COLUMN programs_other, DROP COLUMN programs_json, DROP COLUMN sessions_before,
--     DROP COLUMN lectured_before, DROP COLUMN branch, DROP COLUMN source_form;
--   ALTER TABLE recruitment_notes MODIFY COLUMN kind ENUM('note','contact','evaluation') NOT NULL DEFAULT 'note';

ALTER TABLE join_us_applications
  ADD COLUMN IF NOT EXISTS source_form ENUM('teaching','staff') NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS branch VARCHAR(60) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lectured_before TINYINT(1) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sessions_before TINYINT(1) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS programs_json TEXT NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS programs_other TEXT NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS first_call_rating TINYINT NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS first_call_tags TEXT NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS first_call_notes TEXT NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS first_call_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS first_call_by VARCHAR(36) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS first_call_by_name VARCHAR(200) NULL DEFAULT NULL;

ALTER TABLE join_us_applications
  ALTER COLUMN status SET DEFAULT 'NEW';

ALTER TABLE join_us_applications
  ADD INDEX IF NOT EXISTS idx_join_us_tenant_form_branch (tenant_id, source_form, branch);

ALTER TABLE recruitment_notes
  MODIFY COLUMN kind ENUM('note','contact','evaluation','first_call') NOT NULL DEFAULT 'note';
