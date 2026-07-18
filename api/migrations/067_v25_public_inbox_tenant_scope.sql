-- Public forms are tenant-owned records. Keep the migration idempotent because
-- some installations already received these columns through an older nested
-- migration bundle.
ALTER TABLE contact_messages
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id,
  ADD INDEX IF NOT EXISTS idx_contact_messages_tenant_created (tenant_id, created_at);

ALTER TABLE join_us_applications
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id,
  ADD INDEX IF NOT EXISTS idx_join_us_tenant_created (tenant_id, created_at);

ALTER TABLE job_applicants
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_job_applicants_tenant_stage (tenant_id, stage);

UPDATE job_applicants a
JOIN join_us_applications j ON j.id=a.source_id AND a.source='website'
SET a.tenant_id=j.tenant_id;
