-- The interviews screen reads the candidates at interview or offer, split by their interview date (17 Oct 2026).
--
-- It asks for one tenant's rows at two stages in date order, 50 at a time. (tenant_id, stage) found the rows
-- and the date was sorted afterwards; with the date in the index the page comes back in order.
ALTER TABLE job_applicants ADD INDEX IF NOT EXISTS idx_applicants_tenant_stage_interview (tenant_id, stage, interview_at);
