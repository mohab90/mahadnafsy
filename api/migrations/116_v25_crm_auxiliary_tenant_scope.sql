ALTER TABLE inbox_conversations
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_inbox_tenant_updated (tenant_id, updated_at),
  ADD INDEX IF NOT EXISTS idx_inbox_tenant_lead (tenant_id, linked_lead_id);

ALTER TABLE retargeting_log
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_retargeting_tenant_lead (tenant_id, lead_id, sent_at);
