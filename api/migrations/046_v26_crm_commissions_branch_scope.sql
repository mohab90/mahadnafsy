ALTER TABLE crm_commissions
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other' AFTER tenant_id;

ALTER TABLE crm_commissions
  ADD INDEX IF NOT EXISTS idx_comm_tenant_branch (tenant_id, branch_id);
