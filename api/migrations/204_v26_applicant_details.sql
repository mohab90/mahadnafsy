-- What an application actually needs to say before anyone can judge it.
--
-- job_applicants held a name, a phone and a free-text "specialty" — so the form
-- asked which job in a text box, and two people applying for the same role
-- could write it two different ways and never group together. Nothing recorded
-- which branch they wanted, what they studied, or where they had worked, which
-- are the first three things anyone asks on a screening call.
--
-- Written with IF NOT EXISTS throughout: the first run of this file added the
-- columns and then stopped on an index name that already existed, leaving the
-- schema ahead of the migration log. Re-running has to be safe, and a migration
-- that can only ever apply to a pristine database is a migration that strands
-- you the first time anything goes half-way.
ALTER TABLE job_applicants
  ADD COLUMN IF NOT EXISTS branch VARCHAR(60) NULL
    COMMENT 'Branch the applicant is applying to (branch_key).',
  ADD COLUMN IF NOT EXISTS education VARCHAR(255) NULL
    COMMENT 'Highest qualification, as the applicant states it.',
  ADD COLUMN IF NOT EXISTS experience_places TEXT NULL
    COMMENT 'Where they have worked before, free text.',
  ADD COLUMN IF NOT EXISTS experience_years VARCHAR(20) NULL
    COMMENT 'none | under_1 | 1-3 | 3-5 | 5-10 | 10plus.',
  -- The phone screen is a decision point that had nowhere to live: staff were
  -- tracking "have we called them yet" outside the system entirely.
  ADD COLUMN IF NOT EXISTS phone_interview_at DATETIME NULL
    COMMENT 'When the phone screen happened.',
  ADD COLUMN IF NOT EXISTS phone_interview_result ENUM('passed','failed','no_answer') NULL
    COMMENT 'Outcome of the phone screen.',
  ADD COLUMN IF NOT EXISTS interview_at DATETIME NULL
    COMMENT 'Scheduled interview. Set = it belongs on the interviews screen.',
  ADD COLUMN IF NOT EXISTS decided_at DATETIME NULL
    COMMENT 'When accepted or rejected.',
  ADD COLUMN IF NOT EXISTS decided_by VARCHAR(36) NULL
    COMMENT 'Staff member who accepted or rejected.';

-- idx_applicants_stage already exists on this database under an older
-- definition, so the interview lookup gets its own name rather than fighting
-- over that one.
CREATE INDEX IF NOT EXISTS idx_applicants_interview ON job_applicants (tenant_id, interview_at);
CREATE INDEX IF NOT EXISTS idx_applicants_branch ON job_applicants (tenant_id, branch);
