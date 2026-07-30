CREATE TABLE IF NOT EXISTS daqqi_attendance_events (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  round_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  session_number INT NOT NULL,
  status ENUM('PRESENT','ABSENT','EXCUSED') NOT NULL DEFAULT 'PRESENT',
  source ENUM('MANUAL','QR','IMPORT') NOT NULL DEFAULT 'MANUAL',
  marked_by VARCHAR(36) NULL,
  reason VARCHAR(500) NULL,
  marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_daqqi_attendance_event
    (tenant_id, round_id, subscriber_id, session_number),
  KEY idx_daqqi_attendance_round_session
    (tenant_id, round_id, session_number, status),
  KEY idx_daqqi_attendance_subscriber
    (tenant_id, subscriber_id, marked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
