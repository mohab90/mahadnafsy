-- Tenant ownership and retry/dead-letter state for CRM drip delivery.
ALTER TABLE drip_sequences
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_drip_sequences_tenant (tenant_id, created_at);

ALTER TABLE drip_enrollments
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error VARCHAR(500) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS failed_at DATETIME DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_drip_enrollments_tenant_due (tenant_id, next_send_at, failed_at);
