-- Indexes for tenant-scoped list endpoints and dashboard performance.

ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_hidden_created (tenant_id, hidden, created_at, id);
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_sales_created (tenant_id, assigned_sales_id, hidden, created_at);
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_cs_created (tenant_id, assigned_cs_id, hidden, created_at);

ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_tenant_date_id (tenant_id, date, id);
ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_tenant_status_date (tenant_id, status, date);

ALTER TABLE orders ADD INDEX IF NOT EXISTS idx_orders_tenant_status_created (tenant_id, status, created_at);
