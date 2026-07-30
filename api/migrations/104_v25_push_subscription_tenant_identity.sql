-- Push subscription ownership is tenant-native.
-- A browser endpoint must never be reassigned or queried across tenants.
DROP INDEX IF EXISTS uniq_push_endpoint_hash ON push_subscriptions;

ALTER TABLE push_subscriptions
  ADD UNIQUE INDEX IF NOT EXISTS uq_push_tenant_endpoint (tenant_id, endpoint_hash);
