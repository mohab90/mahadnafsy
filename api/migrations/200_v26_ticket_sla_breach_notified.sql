-- Marks that a ticket's SLA breach has already been announced.
--
-- Every open ticket in this institute had passed its first-response window,
-- because nothing ever raised its hand: a breached ticket looks exactly like
-- one that arrived a minute ago until somebody scrolls far enough down the
-- list. An hourly sweep now notifies the assignee, and management for the
-- worst ones — but only once per ticket, which is what this column records.
-- Without it the sweep would re-announce the same backlog every hour and be
-- muted within a day.
--
-- NULL on every existing row, so the first sweep after deployment announces the
-- current backlog once and then stays quiet.
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_breach_notified_at DATETIME DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_sla_sweep
  ON support_tickets (tenant_id, status, first_response_at, sla_due_at);
