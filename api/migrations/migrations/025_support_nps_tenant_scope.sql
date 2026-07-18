-- Tenant scope for support and satisfaction workflows.
-- Legacy rows remain visible to the default tenant.

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE support_tickets ADD INDEX IF NOT EXISTS idx_support_tickets_tenant_created (tenant_id, created_at);
ALTER TABLE support_tickets ADD INDEX IF NOT EXISTS idx_support_tickets_tenant_status (tenant_id, status, created_at);

ALTER TABLE nps_responses ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE nps_responses ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE nps_responses ADD INDEX IF NOT EXISTS idx_nps_tenant_created (tenant_id, created_at);
ALTER TABLE nps_responses ADD INDEX IF NOT EXISTS idx_nps_tenant_responded (tenant_id, responded_at);

