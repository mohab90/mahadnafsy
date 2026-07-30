ALTER TABLE payments
  ADD INDEX IF NOT EXISTS idx_payments_tenant_branch_date_status
    (tenant_id, branch_id, date, status, deleted_at);

ALTER TABLE orders
  ADD INDEX IF NOT EXISTS idx_orders_tenant_status_created
    (tenant_id, status, created_at);

ALTER TABLE leads
  ADD INDEX IF NOT EXISTS idx_leads_tenant_branch_created
    (tenant_id, branch_id, created_at);

ALTER TABLE recurring_expenses
  ADD INDEX IF NOT EXISTS idx_recurring_schedule
    (is_active, frequency, day_of_month, deleted_at, last_run);
