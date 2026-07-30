CREATE TABLE IF NOT EXISTS accounting_close_requests (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  period_id VARCHAR(36) NOT NULL,
  status ENUM('pending','approved','rejected','consumed') NOT NULL DEFAULT 'pending',
  checklist_snapshot JSON NOT NULL,
  checklist_sha256 CHAR(64) NOT NULL,
  requested_by VARCHAR(100) NOT NULL,
  request_note VARCHAR(1000) NULL,
  reviewed_by VARCHAR(100) NULL,
  review_note VARCHAR(1000) NULL,
  reviewed_at DATETIME NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_close_request_period (tenant_id,period_id,status,created_at),
  CONSTRAINT fk_close_request_period FOREIGN KEY (period_id) REFERENCES accounting_periods(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
