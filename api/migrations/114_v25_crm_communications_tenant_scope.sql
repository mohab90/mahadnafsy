-- CRM communications are tenant-owned and queryable as the canonical interaction log.
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NULL AFTER id;

UPDATE communications c
LEFT JOIN leads l ON l.id = c.lead_id
LEFT JOIN subscribers s ON s.id = c.subscriber_id
SET c.tenant_id = COALESCE(l.tenant_id, s.tenant_id, 'tenant-default')
WHERE c.tenant_id IS NULL OR c.tenant_id = '';

ALTER TABLE communications
  MODIFY tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_comm_tenant_lead_date (tenant_id, lead_id, date),
  ADD INDEX IF NOT EXISTS idx_comm_tenant_subscriber_date (tenant_id, subscriber_id, date);
