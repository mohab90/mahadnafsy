-- Admin/system notifications table.
-- Keeps compatibility with:
-- - api/lib/notification.js: id, type, title, message, data_json
-- - api/routes/core.js: id, type, title, message, data_json, read_at, created_at
-- - api/routes/automation.js: id, subscriber_id, message, type, created_at

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY,
  subscriber_id VARCHAR(100) DEFAULT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'info',
  title VARCHAR(255) DEFAULT NULL,
  message TEXT DEFAULT NULL,
  data_json TEXT DEFAULT NULL,
  read_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_created (created_at),
  INDEX idx_notifications_read (read_at),
  INDEX idx_notifications_subscriber (subscriber_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subscriber_id VARCHAR(100) DEFAULT NULL AFTER id;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'info' AFTER subscriber_id;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT NULL AFTER type;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT DEFAULT NULL AFTER title;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data_json TEXT DEFAULT NULL AFTER message;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at DATETIME DEFAULT NULL AFTER data_json;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER read_at;
