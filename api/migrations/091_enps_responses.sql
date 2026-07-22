-- eNPS (employee Net Promoter Score) — anonymous monthly staff satisfaction.
CREATE TABLE IF NOT EXISTS enps_responses (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  staff_id VARCHAR(36) NOT NULL,
  score TINYINT UNSIGNED NOT NULL COMMENT '0-10',
  comment TEXT DEFAULT NULL,
  period VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_enps_tenant_staff_period (tenant_id, staff_id, period),
  INDEX idx_enps_tenant_period (tenant_id, period)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
