-- Durable connector inbox: acknowledge only after persistence, then retry/replay safely.
CREATE TABLE IF NOT EXISTS connector_events (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  external_event_id VARCHAR(191) NOT NULL,
  payload_json JSON NOT NULL,
  status ENUM('pending','processing','processed','failed','dead') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at DATETIME DEFAULT NULL,
  locked_by VARCHAR(100) DEFAULT NULL,
  last_error VARCHAR(2000) DEFAULT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_connector_external_event (tenant_id, provider, external_event_id),
  KEY idx_connector_event_due (status, next_attempt_at),
  KEY idx_connector_event_health (tenant_id, provider, status, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
