-- One extra paid day off a month for every employee who has worked six months (2 Nov 2026: «يوم اجازة اضافي مجاني شهريا لكل الموظفين اللي عدوا 6 شهور عمل ...
-- كمان اقدر اعدلها»). The policy holds the rule (days a month, months of work needed); an employee can carry their own number of free days (0 = none), NULL = the policy's.
-- It is spent on an absence: the first absent working day(s) of the month are not deducted.
ALTER TABLE hr_policy_versions
  ADD COLUMN IF NOT EXISTS free_day_per_month TINYINT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS free_day_after_months TINYINT UNSIGNED NOT NULL DEFAULT 6;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS free_days_per_month TINYINT UNSIGNED NULL COMMENT 'Free days a month for this employee. NULL = the HR policy''s; 0 = none.';
