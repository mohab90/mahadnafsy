CREATE TABLE IF NOT EXISTS instructor_rate_change_requests (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  staff_id VARCHAR(36) NOT NULL,
  consultation_rate_type ENUM('per_session','percentage','per_hour') NOT NULL DEFAULT 'per_session',
  consultation_rate_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  lecture_rate_per_hour DECIMAL(12,2) NOT NULL DEFAULT 0,
  training_rate_per_hour DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  notes TEXT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  requested_by VARCHAR(36) NULL,
  reviewed_by VARCHAR(36) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_rate_request_pending (tenant_id,status,created_at),
  INDEX idx_rate_request_staff (tenant_id,staff_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
