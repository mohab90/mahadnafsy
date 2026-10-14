-- One-time recovery codes for two-factor sign-in.
--
-- There were none: an employee who lost the phone with the authenticator on it
-- could not sign in again, and the only way to clear their 2FA was HR
-- offboarding them (audit finding, 11 Oct 2026). Ten codes are issued when 2FA
-- is switched on and shown once; only a hash of each is kept here
-- (lib/twoFactor.js), and a code is burned by setting used_at the moment it
-- signs someone in. The owner's reset (POST /api/admin/staff/:id/reset-2fa)
-- removes them with the secret.
--
-- Rollback:
--   DROP TABLE user_mfa_recovery_codes;

CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  user_id VARCHAR(100) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  used_at DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mfa_recovery_code (tenant_id, user_id, code_hash),
  KEY idx_mfa_recovery_unused (tenant_id, user_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
