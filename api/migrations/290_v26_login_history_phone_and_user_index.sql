-- The sign-in log, one page with the accounts (16 Oct 2026).
--
-- A WhatsApp sign-in has no e-mail and its failures had no identity at all, so the log showed a row
-- of dashes for most of what customers do. The number tried is now kept with the attempt, and the log
-- is read by account (user_id) — an index it never had, so a client's own history was a table scan.
ALTER TABLE login_history ADD COLUMN IF NOT EXISTS phone VARCHAR(32) NULL AFTER email;
ALTER TABLE login_history ADD INDEX IF NOT EXISTS idx_login_history_user (tenant_id, user_id, created_at);
