-- 077 made a client code unique per tenant (uq_subs_tenant_code) and dropped
-- the global uq_subs_code. Production still has the global one — api/schema.sql
-- is a dump of the live database and carries both — so a second tenant cannot
-- hold a code the first already uses, which is the isolation 077 was for.
-- tests/integration/db.integration.test.js (the tenant A/B matrix) fails on it.
--
-- Nothing reads the index by name, nothing relies on ON DUPLICATE KEY against
-- client_code, and uq_subs_tenant_code keeps every code unique inside its own
-- tenant — the only uniqueness any screen or report depends on. Codes come from
-- one counter (client_code_counter id=1), so no code is duplicated today.
--
-- Rollback (only while no two tenants share a code):
--   ALTER TABLE subscribers ADD UNIQUE INDEX uq_subs_code (client_code);
-- The per-tenant key first (already there wherever 077 ran), so the column is
-- never without one.
ALTER TABLE subscribers
  ADD UNIQUE INDEX IF NOT EXISTS uq_subs_tenant_code (tenant_id, client_code);
DROP INDEX IF EXISTS uq_subs_code ON subscribers;
