ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_activity_logs_tenant_at (tenant_id, at);

ALTER TABLE activity_logs_archive
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_activity_logs_archive_tenant_at (tenant_id, at);

UPDATE activity_logs
SET tenant_id='tenant-default'
WHERE tenant_id IS NULL OR tenant_id='';

UPDATE activity_logs_archive
SET tenant_id='tenant-default'
WHERE tenant_id IS NULL OR tenant_id='';
