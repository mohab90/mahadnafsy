-- 095_tenant_scope_waitlist_ip_sms.sql
-- Three tables were missing tenant_id entirely, so no query touching them
-- could be tenant-scoped even in principle (found by the tenant-isolation
-- scanner in tools/tenant-scope-scan.mjs): daqqi_waitlist, ip_whitelist,
-- sms_settings. Adds the column with the canonical default established in
-- 033_tenant_default_alignment.sql ('tenant-default', not the old 'mahad').
ALTER TABLE daqqi_waitlist ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX idx_daqqi_waitlist_tenant (tenant_id);
ALTER TABLE ip_whitelist   ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX idx_ip_whitelist_tenant (tenant_id);
ALTER TABLE sms_settings   ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX idx_sms_settings_tenant (tenant_id);

-- ip_whitelist previously had UNIQUE KEY uq_ip (ip) shared across all tenants —
-- that would block two different tenants from whitelisting the same office IP.
-- Replace with a per-tenant uniqueness constraint.
ALTER TABLE ip_whitelist DROP INDEX uq_ip;
ALTER TABLE ip_whitelist ADD UNIQUE KEY uq_tenant_ip (tenant_id, ip);

-- sms_settings previously had a single global row (or a handful from drifted
-- schema history) enforced by no tenant key at all — one tenant editing SMS
-- settings changed them for every tenant. Give each tenant its own settings row.
ALTER TABLE sms_settings ADD UNIQUE KEY uq_sms_settings_tenant (tenant_id);
