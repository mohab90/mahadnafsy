-- Tenant scope for marketing automation tables.
-- Idempotent and non-destructive: legacy rows stay under the default tenant.

ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE email_campaigns ADD INDEX IF NOT EXISTS idx_email_campaigns_tenant_created (tenant_id, created_at);

ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE sms_campaigns ADD INDEX IF NOT EXISTS idx_sms_campaigns_tenant_created (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS drip_campaigns (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default',
  branch_id VARCHAR(36) DEFAULT NULL,
  name VARCHAR(500) NOT NULL,
  trigger_event VARCHAR(255) NOT NULL DEFAULT 'subscription_created'
    COMMENT 'subscription_created|lead_status:interested|consultation_completed|payment_received',
  audience ENUM('subscribers','leads','all') NOT NULL DEFAULT 'subscribers',
  status ENUM('active','paused','draft') NOT NULL DEFAULT 'draft',
  enrolled_count INT NOT NULL DEFAULT 0,
  completed_count INT NOT NULL DEFAULT 0,
  steps JSON NOT NULL DEFAULT ('[]'),
  created_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_drip_campaigns_tenant_created (tenant_id, created_at)
) CHARACTER SET utf8mb4;

ALTER TABLE drip_campaigns ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE drip_campaigns ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE drip_campaigns ADD INDEX IF NOT EXISTS idx_drip_campaigns_tenant_created (tenant_id, created_at);

