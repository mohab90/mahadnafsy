-- When a lead was handed to a rep, as opposed to when it arrived.
--
-- Automatic distribution can now be given a per-rep daily ceiling, so that a
-- large import does not land 200 names on one person who then works none of
-- them properly. Enforcing that needs to know how many leads a rep has already
-- been given *today* — from any source, not just the current run — and nothing
-- recorded the moment of assignment: created_at is when the lead came in, which
-- for imported data is often months earlier or all the same instant.
--
-- Nullable, and left NULL for every existing row: a lead assigned before this
-- column existed simply does not count toward today's cap, which is correct.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_at DATETIME DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_assigned_today ON leads (tenant_id, assigned_sales_id, assigned_at);
