ALTER TABLE message_outbox
  ADD COLUMN IF NOT EXISTS provider VARCHAR(24) NULL AFTER channel,
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(191) NULL AFTER provider,
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(24) NULL AFTER provider_message_id,
  ADD COLUMN IF NOT EXISTS provider_status_at DATETIME NULL AFTER delivery_status,
  ADD COLUMN IF NOT EXISTS delivered_at DATETIME NULL AFTER provider_status_at,
  ADD COLUMN IF NOT EXISTS read_at DATETIME NULL AFTER delivered_at,
  ADD COLUMN IF NOT EXISTS delivery_failed_at DATETIME NULL AFTER read_at,
  ADD COLUMN IF NOT EXISTS provider_error VARCHAR(1000) NULL AFTER delivery_failed_at,
  ADD UNIQUE INDEX IF NOT EXISTS uq_outbox_provider_message (provider, provider_message_id),
  ADD INDEX IF NOT EXISTS idx_outbox_delivery_status (tenant_id, channel, delivery_status, provider_status_at);
