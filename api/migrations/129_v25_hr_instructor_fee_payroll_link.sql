ALTER TABLE instructor_fees
  MODIFY COLUMN status ENUM('pending','approved','included_in_payroll','paid') NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payroll_run_id VARCHAR(36) NULL AFTER paid_at,
  ADD INDEX IF NOT EXISTS idx_instructor_fee_payroll (tenant_id,payroll_run_id,status);
