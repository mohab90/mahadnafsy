-- Default enabled feature flags for the first tenant.
-- These make feature enforcement explicit without changing current UX.

INSERT INTO feature_flags (id, tenant_id, flag_key, is_enabled, config_json)
VALUES
  ('ff-tenant-default-finance', 'tenant-default', 'finance', 1, JSON_OBJECT('source', 'migration_018')),
  ('ff-tenant-default-payments', 'tenant-default', 'payments', 1, JSON_OBJECT('source', 'migration_018')),
  ('ff-tenant-default-leads', 'tenant-default', 'leads', 1, JSON_OBJECT('source', 'migration_018')),
  ('ff-tenant-default-client-portal', 'tenant-default', 'client_portal', 1, JSON_OBJECT('source', 'migration_018')),
  ('ff-tenant-default-branch-workspaces', 'tenant-default', 'branch_workspaces', 1, JSON_OBJECT('source', 'migration_018'))
ON DUPLICATE KEY UPDATE
  is_enabled = VALUES(is_enabled),
  config_json = VALUES(config_json);
