-- Tenant isolation for the legacy HR domain. All existing rows belong to the
-- canonical institute; new writes must provide the request tenant explicitly.

ALTER TABLE IF EXISTS hr_departments            ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_hr_departments_tenant (tenant_id, is_active);
ALTER TABLE IF EXISTS salary_structures         ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_salary_structures_tenant (tenant_id, staff_id, effective_from);
ALTER TABLE IF EXISTS commission_rules          ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_commission_rules_tenant (tenant_id, is_active);
ALTER TABLE IF EXISTS work_schedules            ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_work_schedules_tenant (tenant_id, staff_id);
ALTER TABLE IF EXISTS attendance_logs           ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_attendance_logs_tenant (tenant_id, staff_id, date);
ALTER TABLE IF EXISTS attendance_import_batches ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_attendance_batches_tenant (tenant_id, year, month);
ALTER TABLE IF EXISTS leaves                    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_leaves_tenant (tenant_id, staff_id, status);
ALTER TABLE IF EXISTS salary_advances           ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_salary_advances_tenant (tenant_id, staff_id, status);
ALTER TABLE IF EXISTS hr_audit_logs             ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_hr_audit_tenant (tenant_id, performed_at);
ALTER TABLE IF EXISTS onboarding_templates      ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_onboarding_templates_tenant (tenant_id, role);
ALTER TABLE IF EXISTS onboarding_tasks          ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_onboarding_tasks_tenant (tenant_id, template_id);
ALTER TABLE IF EXISTS employee_onboarding       ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_employee_onboarding_tenant (tenant_id, staff_id, status);
ALTER TABLE IF EXISTS employee_onboarding_items ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_onboarding_items_tenant (tenant_id, onboarding_id);
ALTER TABLE IF EXISTS disciplinary_records      ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_disciplinary_tenant (tenant_id, staff_id, status);
ALTER TABLE IF EXISTS employee_documents        ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_employee_documents_tenant (tenant_id, staff_id);
ALTER TABLE IF EXISTS instructor_rates          ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_instructor_rates_tenant (tenant_id, staff_id);
ALTER TABLE IF EXISTS employee_bonuses          ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_employee_bonuses_tenant (tenant_id, staff_id, for_year, for_month);
ALTER TABLE IF EXISTS instructor_fees           ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_instructor_fees_tenant (tenant_id, staff_id, status);
ALTER TABLE IF EXISTS performance_appraisals    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_appraisals_tenant (tenant_id, staff_id, period_year, period_month);
ALTER TABLE IF EXISTS kpi_targets               ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_kpi_targets_tenant (tenant_id, staff_id, from_date, to_date);
ALTER TABLE IF EXISTS lecture_logs              ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_lecture_logs_tenant (tenant_id, staff_id, lecture_date);

CREATE TABLE IF NOT EXISTS leave_requests (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  staff_id VARCHAR(100) NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'ANNUAL',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days SMALLINT NOT NULL DEFAULT 1,
  reason TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_leave_requests_tenant (tenant_id, staff_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE IF EXISTS leave_requests ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_leave_requests_tenant (tenant_id, staff_id, status, created_at);

CREATE TABLE IF NOT EXISTS staff_absences (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  staff_id VARCHAR(100) NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'absence',
  date DATE NOT NULL,
  reason TEXT NULL,
  is_excused TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_absence_tenant (tenant_id, staff_id, date, type),
  INDEX idx_staff_absences_tenant (tenant_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE IF EXISTS staff_absences ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default', ADD COLUMN IF NOT EXISTS type VARCHAR(30) NOT NULL DEFAULT 'absence', ADD COLUMN IF NOT EXISTS date DATE NULL, ADD INDEX IF NOT EXISTS idx_staff_absences_tenant (tenant_id, date);
