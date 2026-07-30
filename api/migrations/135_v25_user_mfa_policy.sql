-- Authentication factors belong to the authentication identity, not HR data.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64) DEFAULT NULL AFTER session_version,
  ADD COLUMN IF NOT EXISTS totp_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER totp_secret;

-- Preserve existing staff TOTP enrolments during the ownership transition.
UPDATE users u
JOIN staff s
  ON s.tenant_id = u.tenant_id
 AND LOWER(TRIM(s.email)) = LOWER(TRIM(u.email))
SET u.totp_secret = COALESCE(u.totp_secret, s.totp_secret),
    u.totp_enabled = IF(u.totp_enabled = 1 OR s.totp_enabled = 1, 1, 0)
WHERE s.totp_secret IS NOT NULL OR s.totp_enabled = 1;
