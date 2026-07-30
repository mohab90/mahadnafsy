ALTER TABLE recurring_expenses
  ADD COLUMN IF NOT EXISTS branch VARCHAR(50) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NULL AFTER branch,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL DEFAULT NULL AFTER branch_id,
  MODIFY COLUMN frequency ENUM('monthly','weekly','quarterly','yearly') NOT NULL DEFAULT 'monthly',
  ADD INDEX IF NOT EXISTS idx_recurring_expenses_tenant_branch_active
    (tenant_id, branch_id, deleted_at, is_active);

UPDATE recurring_expenses
SET category = CASE TRIM(category)
  WHEN 'رواتب' THEN 'SALARIES'
  WHEN 'تسويق' THEN 'MARKETING'
  WHEN 'إيجار' THEN 'RENT'
  WHEN 'برمجيات' THEN 'SOFTWARE'
  WHEN 'معدات' THEN 'EQUIPMENT'
  WHEN 'مرافق' THEN 'UTILITIES'
  WHEN 'صيانة' THEN 'MAINTENANCE'
  WHEN 'سفر' THEN 'TRAVEL'
  WHEN 'أخرى' THEN 'OTHER'
  ELSE UPPER(category)
END
WHERE category IS NOT NULL;

UPDATE recurring_expenses
SET category = 'OTHER'
WHERE category IS NULL
   OR category NOT IN ('SALARIES','RENT','UTILITIES','SOFTWARE','MARKETING','EQUIPMENT','MAINTENANCE','TRAVEL','OTHER');
