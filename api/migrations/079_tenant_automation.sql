-- Tenant ownership for workflow definitions, execution audit and generated tasks.
ALTER TABLE automation_workflows
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_automation_workflows_tenant_enabled (tenant_id, enabled, created_at);

ALTER TABLE automation_log
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_automation_log_tenant_triggered (tenant_id, triggered_at);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_tasks_tenant_status (tenant_id, status, due_date);
