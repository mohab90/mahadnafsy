ALTER TABLE sales_goals
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id;

DROP INDEX IF EXISTS uq_sales_goals_period ON sales_goals;
DROP INDEX IF EXISTS uq_period ON sales_goals;
ALTER TABLE sales_goals
  ADD UNIQUE INDEX IF NOT EXISTS uq_sales_goals_tenant_period (tenant_id, period),
  ADD INDEX IF NOT EXISTS idx_sales_goals_tenant_updated (tenant_id, updated_at);

ALTER TABLE sales_targets
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' FIRST;

ALTER TABLE sales_targets DROP PRIMARY KEY;
ALTER TABLE sales_targets
  ADD PRIMARY KEY (tenant_id, staff_id, period),
  ADD INDEX IF NOT EXISTS idx_sales_targets_tenant_period (tenant_id, period);
