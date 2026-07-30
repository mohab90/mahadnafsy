ALTER TABLE payment_audit_log
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  MODIFY COLUMN action VARCHAR(80) NOT NULL,
  MODIFY COLUMN amount DECIMAL(12,2) DEFAULT NULL,
  MODIFY COLUMN subscriber_id VARCHAR(64) DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_payment_audit_tenant_created (tenant_id, created_at),
  ADD INDEX IF NOT EXISTS idx_payment_audit_tenant_payment (tenant_id, payment_id);

UPDATE payment_audit_log pal
JOIN payments p ON p.id=pal.payment_id
SET pal.tenant_id=p.tenant_id
WHERE pal.tenant_id='tenant-default' AND p.tenant_id<>'tenant-default';
