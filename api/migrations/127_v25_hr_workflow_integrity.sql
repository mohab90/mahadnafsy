ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other' AFTER tenant_id,
  ADD INDEX IF NOT EXISTS idx_staff_tenant_branch_active (tenant_id,branch_id,is_active,deleted_at);

CREATE TABLE IF NOT EXISTS hr_policy_versions (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  version INT UNSIGNED NOT NULL,
  annual_leave_days DECIMAL(5,1) NOT NULL DEFAULT 21,
  sick_leave_days DECIMAL(5,1) NOT NULL DEFAULT 14,
  work_days_per_month DECIMAL(5,2) NOT NULL DEFAULT 26,
  workday_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 480,
  grace_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  overtime_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.50,
  weekend_days_json JSON NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  created_by VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hr_policy_version (tenant_id,version),
  INDEX idx_hr_policy_effective (tenant_id,effective_from,effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO hr_policy_versions
  (id,tenant_id,version,annual_leave_days,sick_leave_days,work_days_per_month,
   workday_minutes,grace_minutes,overtime_multiplier,weekend_days_json,effective_from)
SELECT UUID(),tenant_id,1,21,14,26,480,15,1.5,JSON_ARRAY(5,6),'2025-01-01'
  FROM staff GROUP BY tenant_id;

INSERT IGNORE INTO hr_policy_versions
  (id,tenant_id,version,annual_leave_days,sick_leave_days,work_days_per_month,
   workday_minutes,grace_minutes,overtime_multiplier,weekend_days_json,effective_from)
VALUES
  (UUID(),'tenant-default',1,21,14,26,480,15,1.5,JSON_ARRAY(5,6),'2025-01-01');

ALTER TABLE leaves
  ADD COLUMN IF NOT EXISTS policy_id VARCHAR(36) NULL AFTER tenant_id,
  ADD INDEX IF NOT EXISTS idx_leaves_policy (tenant_id,policy_id);

ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS leave_id VARCHAR(36) NULL AFTER import_batch_id,
  ADD INDEX IF NOT EXISTS idx_attendance_leave (tenant_id,leave_id);
