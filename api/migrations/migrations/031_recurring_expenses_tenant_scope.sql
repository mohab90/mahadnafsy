ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE recurring_expenses ADD INDEX IF NOT EXISTS idx_recurring_expenses_tenant_created (tenant_id, created_at);
ALTER TABLE recurring_expenses ADD INDEX IF NOT EXISTS idx_recurring_expenses_tenant_active_day (tenant_id, is_active, day_of_month, last_run);
