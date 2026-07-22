ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_notifications_tenant_created (tenant_id, created_at),
  ADD INDEX IF NOT EXISTS idx_notifications_tenant_read (tenant_id, read_at);
