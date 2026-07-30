-- One active IP-bound session per account, auditable reset-email delivery,
-- and server-owned customer country/currency context.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_session_id VARCHAR(36) NULL AFTER session_version,
  ADD COLUMN IF NOT EXISTS active_session_ip_hash CHAR(64) NULL AFTER active_session_id,
  ADD COLUMN IF NOT EXISTS active_session_started_at DATETIME NULL AFTER active_session_ip_hash,
  ADD COLUMN IF NOT EXISTS active_session_last_seen_at DATETIME NULL AFTER active_session_started_at,
  ADD COLUMN IF NOT EXISTS last_country_code CHAR(2) NULL AFTER active_session_last_seen_at,
  ADD COLUMN IF NOT EXISTS preferred_currency CHAR(3) NULL AFTER last_country_code,
  ADD COLUMN IF NOT EXISTS last_geo_at DATETIME NULL AFTER preferred_currency,
  ADD UNIQUE INDEX IF NOT EXISTS uq_users_tenant_active_session (tenant_id, active_session_id);

ALTER TABLE otp_codes
  ADD COLUMN IF NOT EXISTS delivery_status ENUM('pending','accepted','failed') NOT NULL DEFAULT 'pending' AFTER used,
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255) NULL AFTER delivery_status,
  ADD COLUMN IF NOT EXISTS delivery_error_code VARCHAR(80) NULL AFTER provider_message_id,
  ADD COLUMN IF NOT EXISTS sent_at DATETIME NULL AFTER delivery_error_code,
  ADD INDEX IF NOT EXISTS idx_otp_tenant_delivery (tenant_id, type, delivery_status, created_at);
