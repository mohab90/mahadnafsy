ALTER TABLE payment_proofs ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other' AFTER tenant_id;
ALTER TABLE payment_proofs ADD INDEX IF NOT EXISTS idx_proofs_tenant_branch (tenant_id, branch_id);
