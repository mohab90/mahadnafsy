ALTER TABLE salary_structures
  ADD COLUMN IF NOT EXISTS status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING' AFTER effective_to,
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(100) NULL AFTER created_by,
  ADD COLUMN IF NOT EXISTS approved_at DATETIME NULL AFTER approved_by,
  ADD INDEX IF NOT EXISTS idx_salary_status (tenant_id,staff_id,status,effective_from);

UPDATE salary_structures
   SET status='APPROVED',approved_at=COALESCE(approved_at,created_at)
 WHERE status='PENDING';

ALTER TABLE employee_bonuses
  ADD COLUMN IF NOT EXISTS status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING' AFTER amount,
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(100) NULL AFTER created_by,
  ADD COLUMN IF NOT EXISTS approved_at DATETIME NULL AFTER approved_by,
  ADD INDEX IF NOT EXISTS idx_bonuses_status (tenant_id,status,for_year,for_month);

UPDATE employee_bonuses
   SET status='APPROVED',approved_at=COALESCE(approved_at,created_at)
 WHERE status='PENDING';

ALTER TABLE instructor_fees
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(100) NULL AFTER created_by,
  ADD COLUMN IF NOT EXISTS approved_at DATETIME NULL AFTER approved_by,
  ADD COLUMN IF NOT EXISTS paid_by VARCHAR(100) NULL AFTER approved_at,
  ADD COLUMN IF NOT EXISTS paid_at DATETIME NULL AFTER paid_by;
