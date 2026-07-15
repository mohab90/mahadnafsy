ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other' AFTER tenant_id;

ALTER TABLE enrollments
  ADD INDEX IF NOT EXISTS idx_enrollments_tenant_branch (tenant_id, branch_id);
