ALTER TABLE lead_merge_audit
  ADD COLUMN IF NOT EXISTS reverted_at DATETIME NULL AFTER created_at,
  ADD COLUMN IF NOT EXISTS reverted_by VARCHAR(255) NULL AFTER reverted_at,
  ADD INDEX IF NOT EXISTS idx_lead_merge_active (tenant_id, source_lead_id, reverted_at);
