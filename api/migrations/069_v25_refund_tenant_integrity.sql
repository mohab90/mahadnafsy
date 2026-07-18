-- Refund workflow isolation and lookup performance.
-- The route layer writes tenant_id explicitly; these indexes make tenant-bound
-- duplicate checks, approval locks and payment reconciliation deterministic.
ALTER TABLE refund_requests
  ADD INDEX IF NOT EXISTS idx_refund_tenant_subscriber_status (tenant_id, subscriber_id, status),
  ADD INDEX IF NOT EXISTS idx_refund_tenant_payment (tenant_id, payment_id);
