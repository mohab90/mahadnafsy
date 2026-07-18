-- Core tenant scope catch-up for SaaS isolation.
-- Runtime guard v46 in startupTasks.js stays temporarily until all environments run migrations.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_created (tenant_id, created_at);
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_status_created (tenant_id, status, created_at);

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subscribers_tenant_created (tenant_id, created_at);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_tenant_date (tenant_id, `date`);
ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_tenant_status_date (tenant_id, status, `date`);

ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE refund_requests ADD INDEX IF NOT EXISTS idx_refunds_tenant_created (tenant_id, created_at);

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE support_tickets ADD INDEX IF NOT EXISTS idx_support_tickets_tenant_created (tenant_id, created_at);
ALTER TABLE support_tickets ADD INDEX IF NOT EXISTS idx_support_tickets_tenant_status (tenant_id, status, created_at);
