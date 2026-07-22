ALTER TABLE finance_outbox
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(255) NULL AFTER ref_id,
  ADD COLUMN IF NOT EXISTS locked_at DATETIME NULL AFTER next_attempt_at,
  ADD COLUMN IF NOT EXISTS locked_by VARCHAR(100) NULL AFTER locked_at,
  MODIFY COLUMN status ENUM('pending','processing','processed','failed','dead') NOT NULL DEFAULT 'pending',
  ADD UNIQUE INDEX IF NOT EXISTS uq_finance_outbox_tenant_dedupe (tenant_id, dedupe_key),
  ADD INDEX IF NOT EXISTS idx_finance_outbox_tenant_status_next (tenant_id, status, next_attempt_at);
