-- Customer service workflow indexes extracted from runtime usage patterns.
-- Keeps unified inbox, refunds, contact messages, and join requests responsive
-- as tenant/branch data grows.

ALTER TABLE support_tickets
  ADD INDEX IF NOT EXISTS idx_support_tenant_status_created (tenant_id, status, created_at);

ALTER TABLE refund_requests
  ADD INDEX IF NOT EXISTS idx_refunds_tenant_status_created (tenant_id, status, created_at);

ALTER TABLE contact_messages
  ADD INDEX IF NOT EXISTS idx_contact_tenant_status_created (tenant_id, status, created_at);

ALTER TABLE join_us_applications
  ADD INDEX IF NOT EXISTS idx_join_tenant_type_status_created (tenant_id, type, status, created_at);

ALTER TABLE payments
  ADD INDEX IF NOT EXISTS idx_payments_tenant_status_created (tenant_id, status, created_at);
