-- Two-factor for privileged staff is on by default now, with a grace period per account (lib/mfaPolicy.js), and an
-- account can see where it is signed in and sign the other devices out (routes/auth/sessions.js) (21 Oct 2026).
--
-- mfa_grace_started_at: the first time a privileged account without 2FA was told to enrol. The grace period counts
-- from here (or from when the owner switched the policy on, whichever is later), so a new hire or a promotion gets
-- the same days as everybody had at rollout instead of being locked out on their first sign-in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_grace_started_at DATETIME NULL DEFAULT NULL;

-- One row per sign-in. A staff account may be signed in on several devices at once (lib/singleSession.js), and there
-- was nothing to list them by: only the latest session id was kept on users. A row is live while its
-- session_version is the account's and it has not been revoked; the token itself stays the authority.
CREATE TABLE IF NOT EXISTS user_sessions (
  tenant_id varchar(64) NOT NULL,
  session_id varchar(36) NOT NULL,
  user_id varchar(100) NOT NULL,
  session_version int(10) unsigned NOT NULL,
  ip_hint varchar(64) DEFAULT NULL,
  user_agent varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  last_seen_at datetime NOT NULL DEFAULT current_timestamp(),
  revoked_at datetime DEFAULT NULL,
  PRIMARY KEY (tenant_id, session_id),
  KEY idx_user_sessions_user (tenant_id, user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
