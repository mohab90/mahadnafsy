ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_email_campaigns_tenant_created (tenant_id, created_at);

ALTER TABLE sms_campaigns
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_sms_campaigns_tenant_created (tenant_id, created_at);

ALTER TABLE webhooks
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_webhooks_tenant_active (tenant_id, is_active);

ALTER TABLE message_outbox
  ADD COLUMN IF NOT EXISTS ref_type VARCHAR(80) NULL AFTER dedupe_key,
  ADD COLUMN IF NOT EXISTS ref_id VARCHAR(100) NULL AFTER ref_type,
  ADD COLUMN IF NOT EXISTS locked_at DATETIME NULL AFTER next_attempt_at,
  ADD COLUMN IF NOT EXISTS locked_by VARCHAR(100) NULL AFTER locked_at,
  MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  MODIFY COLUMN channel ENUM('email','whatsapp','sms','push') NOT NULL,
  MODIFY COLUMN status ENUM('pending','processing','sent','failed','dead') NOT NULL DEFAULT 'pending',
  DROP INDEX IF EXISTS uniq_outbox_dedupe,
  ADD UNIQUE INDEX IF NOT EXISTS uq_message_outbox_tenant_dedupe (tenant_id, dedupe_key),
  ADD INDEX IF NOT EXISTS idx_message_outbox_tenant_due (tenant_id, status, next_attempt_at),
  ADD INDEX IF NOT EXISTS idx_message_outbox_ref (tenant_id, ref_type, ref_id);

UPDATE message_outbox SET tenant_id='tenant-default' WHERE tenant_id='mahad';

CREATE TABLE IF NOT EXISTS marketing_suppressions (
  tenant_id VARCHAR(64) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  destination_hash CHAR(64) NOT NULL,
  subject_type VARCHAR(20) NOT NULL,
  subject_id VARCHAR(100) NOT NULL,
  suppressed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, channel, destination_hash),
  KEY idx_marketing_suppression_subject (tenant_id, subject_type, subject_id, channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marketing_consent_audit (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  subject_type VARCHAR(20) NOT NULL,
  subject_id VARCHAR(100) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  action VARCHAR(30) NOT NULL,
  source VARCHAR(80) NOT NULL,
  actor VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_marketing_consent_subject (tenant_id, subject_type, subject_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
