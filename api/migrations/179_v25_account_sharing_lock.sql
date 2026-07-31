-- 179: temporary account lock when a login is shared across too many networks.
--
-- Single-session binding (lib/singleSession.js) already guarantees only ONE
-- device holds a live session: each login rotates session_version and the
-- request IP is part of the session check, so a second device silently signs the
-- first one out. What it does NOT do is notice the pattern — a password passed
-- around a study group produces an endless chain of sign-outs, and each
-- individual login looks perfectly legitimate.
--
-- This records how many distinct networks an account has authenticated from and
-- lets the app suspend it for a cool-off period once the threshold is crossed.
-- Idempotent so the runner can re-apply safely.

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS sharing_locked_until DATETIME NULL DEFAULT NULL
    COMMENT 'Temporary suspension after logins from too many distinct IPs',
  ADD COLUMN IF NOT EXISTS sharing_lock_reason VARCHAR(160) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sharing_lock_count INT NOT NULL DEFAULT 0
    COMMENT 'How many times this account has been auto-locked for sharing';

-- Lock lookups run on every login attempt, so keep them index-served.
ALTER TABLE IF EXISTS users
  ADD INDEX IF NOT EXISTS idx_users_sharing_lock (tenant_id, sharing_locked_until);

-- The distinct-IP count is read from login_history per email over a rolling
-- window; this index keeps that scan off the full table.
ALTER TABLE IF EXISTS login_history
  ADD INDEX IF NOT EXISTS idx_login_history_email_created_ip (email, created_at, ip);
