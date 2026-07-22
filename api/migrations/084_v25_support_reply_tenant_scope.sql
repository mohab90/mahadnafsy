ALTER TABLE ticket_replies
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_ticket_replies_tenant (tenant_id, ticket_id, created_at);

UPDATE ticket_replies tr
JOIN support_tickets t ON t.id=tr.ticket_id
SET tr.tenant_id=t.tenant_id
WHERE tr.tenant_id IS NULL OR tr.tenant_id IN ('', 'mahad', 'tenant-default');
