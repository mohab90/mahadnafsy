-- Revoke all outstanding JWTs after any credential or account-state change.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER is_active,
  ADD INDEX IF NOT EXISTS idx_users_tenant_session
    (tenant_id, id, is_active, session_version);

UPDATE users
SET session_version = 1
WHERE session_version IS NULL OR session_version < 1;
