-- An email given at sign-up is a claim until its owner proves it (21 Oct 2026, lib/emailVerification.js).
--
-- Accounts were matched to their client record, signed in and sent password-reset codes by the email typed at
-- sign-up, which nobody checked. email_unverified marks a sign-up whose address is not proven yet; while it is 1 the
-- address is not an identity anywhere (lib/subscriberIdentity.js, login, password reset, the token's email).
-- DEFAULT 0 on purpose: accounts that already exist, and those staff create, keep working as they always have.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_unverified TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at DATETIME NULL DEFAULT NULL;

-- The link and the code sent to prove an address. Only hashes are kept.
CREATE TABLE IF NOT EXISTS email_verifications (
  id varchar(36) NOT NULL,
  tenant_id varchar(64) NOT NULL,
  user_id varchar(100) NOT NULL,
  email varchar(255) NOT NULL,
  token_hash char(64) NOT NULL,
  code_hash char(64) NOT NULL,
  attempts int(11) NOT NULL DEFAULT 0,
  expires_at datetime NOT NULL,
  used_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_verifications_token (token_hash),
  KEY idx_email_verifications_user (tenant_id, user_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
