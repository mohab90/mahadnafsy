-- Tenant ownership for operational notifications and reminder idempotency.
ALTER TABLE admin_notifications
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE admin_notifications
  ADD INDEX IF NOT EXISTS idx_admin_notifications_tenant_created (tenant_id, created_at);

ALTER TABLE reminder_log
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE reminder_log
  ADD INDEX IF NOT EXISTS idx_reminder_log_tenant_sent (tenant_id, sent_at);
