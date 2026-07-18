-- Payroll calculation columns for salary structures.
-- Mirrors the temporary startup guard in api/lib/startupTasks.js v28.

ALTER TABLE salary_structures
  ADD COLUMN IF NOT EXISTS food_allowance DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_fixed DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_social_insurance DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_tax DECIMAL(10,2) NOT NULL DEFAULT 0;
