ALTER TABLE performance_appraisals
  ADD COLUMN IF NOT EXISTS reviewer_id VARCHAR(100) NULL AFTER reviewer_email,
  ADD COLUMN IF NOT EXISTS evidence_json JSON NULL AFTER kpi_scores,
  ADD COLUMN IF NOT EXISTS submitted_at DATETIME NULL AFTER status,
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(100) NULL AFTER submitted_at,
  ADD COLUMN IF NOT EXISTS approved_at DATETIME NULL AFTER approved_by,
  ADD INDEX IF NOT EXISTS idx_appraisal_workflow (tenant_id,status,period_year,period_month);
