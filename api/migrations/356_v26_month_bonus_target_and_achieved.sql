-- A bonus for one employee for one month, written with what was asked of them and what they reached (2 Nov 2026: «أضيف مكافأة لكل موظف على كل شهر وأكتب
-- تحقيق المطلوب كام والمكافأة كام»). source='MONTH_SHEET' marks the one row per employee and month that the month sheet owns, so saving it again
-- updates that row instead of adding another. It is still an employee_bonuses row: pending until a second person approves it, then payroll counts it.
ALTER TABLE employee_bonuses
  ADD COLUMN IF NOT EXISTS target_value DECIMAL(12,2) NULL COMMENT 'What was required of the employee that month, in target_unit.',
  ADD COLUMN IF NOT EXISTS achieved_value DECIMAL(12,2) NULL COMMENT 'What the employee reached that month, in target_unit.',
  ADD COLUMN IF NOT EXISTS target_unit VARCHAR(10) NULL COMMENT 'clients, bookings or egp (staff.monthly_target_type).',
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NULL COMMENT 'MONTH_SHEET for the row the month sheet writes.';
