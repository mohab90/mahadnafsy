-- Preserve support history and keep active-ticket queries efficient.
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME DEFAULT NULL AFTER updated_at,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(36) DEFAULT NULL AFTER deleted_at,
  ADD INDEX IF NOT EXISTS idx_support_tickets_tenant_active
    (tenant_id, deleted_at, status, created_at);
