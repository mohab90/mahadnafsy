ALTER TABLE hr_policy_versions
  ADD COLUMN IF NOT EXISTS audit_retention_days INT UNSIGNED NOT NULL DEFAULT 2555 AFTER overtime_multiplier;
