-- Tenant scope for public contact and join-us workflows.
-- Legacy rows remain visible to the default tenant.

ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE contact_messages ADD INDEX IF NOT EXISTS idx_contact_messages_tenant_created (tenant_id, created_at);
ALTER TABLE contact_messages ADD INDEX IF NOT EXISTS idx_contact_messages_tenant_status (tenant_id, status, created_at);

ALTER TABLE join_us_applications ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE join_us_applications ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE join_us_applications ADD INDEX IF NOT EXISTS idx_join_us_tenant_created (tenant_id, created_at);
ALTER TABLE join_us_applications ADD INDEX IF NOT EXISTS idx_join_us_tenant_type_status (tenant_id, type, status, created_at);
