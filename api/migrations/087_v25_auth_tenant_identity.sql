-- Authentication identity, OTPs and security history must be isolated by tenant.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id;
DROP INDEX IF EXISTS uq_users_email ON users;
DROP INDEX IF EXISTS email ON users;
ALTER TABLE users
  ADD UNIQUE INDEX IF NOT EXISTS uq_users_tenant_email (tenant_id, email(191)),
  ADD INDEX IF NOT EXISTS idx_users_tenant_active (tenant_id, is_active),
  ADD INDEX IF NOT EXISTS idx_users_tenant_firebase (tenant_id, firebase_uid);

ALTER TABLE otp_codes
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_otp_tenant_email_type (tenant_id, email(191), type, used, expires_at);

ALTER TABLE login_history
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_login_history_tenant_created (tenant_id, created_at),
  ADD INDEX IF NOT EXISTS idx_login_history_tenant_status (tenant_id, status, created_at);

DROP INDEX IF EXISTS idx_staff_email ON staff;
DROP INDEX IF EXISTS idx_staff_firebase_uid ON staff;
ALTER TABLE staff
  ADD UNIQUE INDEX IF NOT EXISTS uq_staff_tenant_email (tenant_id, email(191)),
  ADD UNIQUE INDEX IF NOT EXISTS uq_staff_tenant_firebase (tenant_id, firebase_uid);
