-- Extend default SaaS feature flags to every large admin domain guarded by adminFeatureGate.

INSERT INTO feature_flags (id, tenant_id, flag_key, is_enabled, config_json)
VALUES
  ('ff-tenant-default-hr', 'tenant-default', 'hr', 1, JSON_OBJECT('source', 'migration_019')),
  ('ff-tenant-default-marketing', 'tenant-default', 'marketing', 1, JSON_OBJECT('source', 'migration_019')),
  ('ff-tenant-default-support', 'tenant-default', 'support', 1, JSON_OBJECT('source', 'migration_019')),
  ('ff-tenant-default-daqqi', 'tenant-default', 'daqqi', 1, JSON_OBJECT('source', 'migration_019')),
  ('ff-tenant-default-settings', 'tenant-default', 'settings', 1, JSON_OBJECT('source', 'migration_019')),
  ('ff-tenant-default-security', 'tenant-default', 'security', 1, JSON_OBJECT('source', 'migration_019')),
  ('ff-tenant-default-analytics', 'tenant-default', 'analytics', 1, JSON_OBJECT('source', 'migration_019'))
ON DUPLICATE KEY UPDATE
  is_enabled = VALUES(is_enabled),
  config_json = VALUES(config_json);
