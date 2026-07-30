ALTER TABLE salary_advances
  ADD COLUMN IF NOT EXISTS requested_by VARCHAR(36) NULL AFTER reason,
  ADD COLUMN IF NOT EXISTS disbursed_by VARCHAR(36) NULL AFTER approved_by,
  ADD COLUMN IF NOT EXISTS disbursed_at DATETIME NULL AFTER approved_at,
  ADD COLUMN IF NOT EXISTS journal_entry_id VARCHAR(36) NULL AFTER disbursed_at,
  ADD COLUMN IF NOT EXISTS deducted_payroll_run_id VARCHAR(36) NULL AFTER approved_at,
  ADD INDEX IF NOT EXISTS idx_advances_requester (tenant_id, requested_by, status),
  ADD INDEX IF NOT EXISTS idx_advances_payroll_run (tenant_id, deducted_payroll_run_id);

ALTER TABLE salary_advances
  MODIFY COLUMN status ENUM('PENDING','APPROVED','DISBURSED','DEDUCTED','REJECTED')
    NOT NULL DEFAULT 'PENDING';

ALTER TABLE disciplinary_records
  ADD COLUMN IF NOT EXISTS appeal_note TEXT NULL AFTER action_taken,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NULL AFTER created_at;

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL AFTER created_at,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(36) NULL AFTER deleted_at,
  ADD INDEX IF NOT EXISTS idx_employee_documents_active (tenant_id, staff_id, deleted_at);
