-- Budget plans are business data and must be unique inside a tenant, not globally.
ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;

DROP INDEX IF EXISTS uq_budget ON budgets;

ALTER TABLE budgets
  ADD UNIQUE INDEX IF NOT EXISTS uq_budget_tenant (tenant_id, month, category),
  ADD INDEX IF NOT EXISTS idx_budgets_tenant_month (tenant_id, month);
