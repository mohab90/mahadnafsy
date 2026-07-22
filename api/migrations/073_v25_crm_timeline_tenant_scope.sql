-- Tenant-bound CRM timeline. Existing rows belong to the canonical institute.
ALTER TABLE lead_timeline
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_lead_timeline_tenant_lead_at (tenant_id, lead_id, at);
