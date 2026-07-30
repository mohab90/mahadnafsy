-- Recipient-aware notifications and per-user read state.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS recipient_staff_id VARCHAR(36) DEFAULT NULL AFTER subscriber_id,
  ADD INDEX IF NOT EXISTS idx_notifications_recipient
    (tenant_id, recipient_staff_id, created_at);

CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  viewer_key VARCHAR(160) NOT NULL,
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id, tenant_id, viewer_key),
  KEY idx_notification_reads_viewer (tenant_id, viewer_key, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
