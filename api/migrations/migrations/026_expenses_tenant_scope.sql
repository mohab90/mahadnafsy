-- Tenant scope for accounting expenses used by P&L, cashflow, VAT, and analytics.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id;
ALTER TABLE expenses ADD INDEX IF NOT EXISTS idx_expenses_tenant_date (tenant_id, `date`);
ALTER TABLE expenses ADD INDEX IF NOT EXISTS idx_expenses_tenant_category_date (tenant_id, category, `date`);

