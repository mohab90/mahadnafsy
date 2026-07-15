-- Lets HR target a job posting at a specific branch (or leave it branch-agnostic).
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS branch VARCHAR(30) NULL AFTER department_id;
