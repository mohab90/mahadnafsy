-- Sign-in by a code sent to the email replaces the authenticator app (29 Oct 2026).
--
-- «محتاج الغي فكرة تطبيق المصادقه دا تماما واخلي الدخول علي السسيتم بكود بيروح للايميل فقط». After the password, an account the
-- security policy names (lib/mfaPolicy.js: the owner, the managers, finance, HR…) is sent a six-digit code at its own email and
-- gets in with it (lib/loginEmailCode.js). Only the hash of the code is kept, and a code burns after five wrong tries.
CREATE TABLE IF NOT EXISTS login_email_codes (
  id varchar(36) NOT NULL,
  tenant_id varchar(64) NOT NULL,
  user_id varchar(100) NOT NULL,
  email varchar(255) NOT NULL,
  code_hash char(64) NOT NULL,
  attempts int(11) NOT NULL DEFAULT 0,
  expires_at datetime NOT NULL,
  used_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_login_email_codes_user (tenant_id, user_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The authenticator secrets and recovery codes are gone with the app: nothing reads them any more, and a copy of either table
-- would otherwise still hold every employee's secret.
UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE totp_enabled = 1 OR totp_secret IS NOT NULL;
UPDATE staff SET totp_enabled = 0, totp_secret = NULL WHERE totp_enabled = 1 OR totp_secret IS NOT NULL;
DELETE FROM user_mfa_recovery_codes;
