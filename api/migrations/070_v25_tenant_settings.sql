-- Backfill the tenant-owned store introduced in migration 027 and hardened in
-- 057. The original site_config rows remain as a rollout fallback for default.
INSERT INTO tenant_settings (id, tenant_id, section, config_json, is_secret)
SELECT UUID(), 'tenant-default', `key`, `value`,
       IF(`key` IN ('sys_payment_gateway','sys_lead_source_connectors','sys_otp_provider'), 1, 0)
FROM site_config
WHERE `key` LIKE 'sys\_%' AND JSON_VALID(`value`)
ON DUPLICATE KEY UPDATE config_json=VALUES(config_json), is_secret=VALUES(is_secret);
