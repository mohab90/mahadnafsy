-- subscribers.lead_id had no index. The integrity check "converted leads have a
-- linked subscriber" (lib/reconcileChecks.js LIVE_SUBSCRIBER_FOR_LEAD, also the
-- payops screen) looks a lead's customer up by it, so each converted lead read
-- the tenant's subscribers: minutes at 30k converted leads and 50k clients, run
-- at boot. With this and the predicate split into three indexed lookups: 4 s.
--
-- Additive. Rollback: DROP INDEX idx_subscribers_tenant_lead ON subscribers.

CREATE INDEX IF NOT EXISTS idx_subscribers_tenant_lead
  ON subscribers (tenant_id, lead_id);
