-- 031_recruiting_pipeline_link.sql
-- Close the HR dead-end: website "join us" applications never entered the HR
-- recruiting funnel (job_postings -> job_applicants). This adds the columns that
-- let a website applicant become a tracked applicant, and a hired applicant
-- become a staff member. Idempotent + additive (MariaDB 11.8).

-- job_applicants: carry website provenance + the extra fields the join form has.
ALTER TABLE IF EXISTS job_applicants
  ADD COLUMN IF NOT EXISTS tenant_id      VARCHAR(36)  DEFAULT 'tenant-default',
  ADD COLUMN IF NOT EXISTS source         VARCHAR(30)  NOT NULL DEFAULT 'manual' COMMENT 'manual|website',
  ADD COLUMN IF NOT EXISTS source_id      VARCHAR(36)  DEFAULT NULL COMMENT 'join_us_applications.id when source=website',
  ADD COLUMN IF NOT EXISTS specialty      VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS applicant_type VARCHAR(30)  DEFAULT NULL COMMENT 'INSTRUCTOR|CONSULTANT|EMPLOYEE',
  ADD COLUMN IF NOT EXISTS linkedin       VARCHAR(300) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS hired_staff_id VARCHAR(36)  DEFAULT NULL COMMENT 'staff.id created when applicant is hired';

ALTER TABLE IF EXISTS job_applicants
  ADD INDEX IF NOT EXISTS idx_applicants_source (source, source_id),
  ADD INDEX IF NOT EXISTS idx_applicants_stage (stage);

-- join_us_applications: mark which ones entered the pipeline + review workflow.
ALTER TABLE IF EXISTS join_us_applications
  ADD COLUMN IF NOT EXISTS converted_applicant_id VARCHAR(36) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS assigned_to            VARCHAR(36) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at            DATETIME    DEFAULT NULL;

ALTER TABLE IF EXISTS join_us_applications
  ADD INDEX IF NOT EXISTS idx_joinus_status (status),
  ADD INDEX IF NOT EXISTS idx_joinus_converted (converted_applicant_id);
