ALTER TABLE job_queue
  ADD COLUMN dedupe_key VARCHAR(160) NULL AFTER job_type,
  ADD UNIQUE KEY uq_job_queue_dedupe (tenant_id, job_type, dedupe_key),
  ADD KEY idx_job_stale (status, locked_at);
