-- Internal-only branches: usable for job postings and staff assignment
-- (branch validation, job_postings.branch, staff.branch_id via hire-from-
-- applicant), but deliberately excluded from the public "الفرع الأقرب"
-- picker, which is separately filtered client-side by this same flag.
-- `is_active` already means "this branch exists/is enabled" (checked by
-- validateJobReferences before a job posting can use it) — internal_only is
-- a distinct concern, so it needs its own column rather than overloading that one.
ALTER TABLE IF EXISTS branches
  ADD COLUMN IF NOT EXISTS internal_only TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active;
