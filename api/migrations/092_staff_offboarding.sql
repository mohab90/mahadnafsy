-- Staff offboarding (exit) workflow — checklist-driven, revokes access on completion.
CREATE TABLE IF NOT EXISTS staff_offboarding (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  staff_id VARCHAR(36) NOT NULL,
  staff_name VARCHAR(255) DEFAULT NULL,
  reason ENUM('resignation','termination','end_contract','other') NOT NULL DEFAULT 'resignation',
  last_working_day DATE DEFAULT NULL,
  status ENUM('in_progress','completed','cancelled') NOT NULL DEFAULT 'in_progress',
  checklist JSON DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  created_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_offboarding_tenant_staff (tenant_id, staff_id),
  INDEX idx_offboarding_tenant_status (tenant_id, status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
