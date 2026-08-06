-- Employee-submitted resignation notice.
--
-- Distinct from staff_offboarding on purpose: that table is the HR-run exit
-- *process* and explicitly refuses to let an employee start their own
-- (routes/hr/offboarding.js returns 409 for a self-start). This table is the
-- notice that reaches HR beforehand, so the employee has a way to resign
-- through the system instead of outside it.
CREATE TABLE IF NOT EXISTS staff_resignations (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  staff_id VARCHAR(36) NOT NULL,
  staff_name VARCHAR(255) DEFAULT NULL,
  last_working_day DATE NOT NULL,
  reason_note TEXT DEFAULT NULL,
  status ENUM('pending','accepted','declined','withdrawn') NOT NULL DEFAULT 'pending',
  hr_note TEXT DEFAULT NULL,
  decided_by VARCHAR(36) DEFAULT NULL,
  decided_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_resign_tenant_staff (tenant_id, staff_id, created_at),
  INDEX idx_resign_tenant_status (tenant_id, status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
