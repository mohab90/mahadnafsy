-- «لازم ندخل الراتب الأساسي لكل موظف ورقمه في البصمة … رفع شيت البصمة عن طول
-- الشهر … السيستم يحسب التأخير والغيابات بنفسه … سياسات الشركة».
--
-- staff.biometric_user_no   the employee's number on the fingerprint device,
--                           the key a device export is matched on (names in an
--                           export are typed on the device and rarely match).
-- hr_policy_versions        the working day (11:00–18:30), the monthly
--                           permissions (morning up to 2 h, evening up to 1.5 h)
--                           and the lateness tiers (>10 min ¼ day, >30 ½, >120 1)
--                           as part of the versioned policy HR already edits.
-- attendance_logs           what lib/attendancePolicy.js decided for the day:
--                           minutes left early, the permission it used, the
--                           fraction of a day deducted, the raw punches, and a
--                           flag for a day HR should look at (one punch only).
--
-- Rollback:
--   ALTER TABLE staff DROP INDEX uq_staff_tenant_biometric, DROP COLUMN biometric_user_no;
--   ALTER TABLE hr_policy_versions DROP COLUMN work_start_time, DROP COLUMN work_end_time,
--     DROP COLUMN morning_permit_minutes, DROP COLUMN evening_permit_minutes,
--     DROP COLUMN morning_permits_per_month, DROP COLUMN evening_permits_per_month,
--     DROP COLUMN late_tiers_json, DROP COLUMN early_leave_tiered;
--   ALTER TABLE attendance_logs DROP COLUMN early_leave_minutes, DROP COLUMN deduction_days,
--     DROP COLUMN permit_used, DROP COLUMN punches_json, DROP COLUMN review_flag;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS biometric_user_no VARCHAR(32) NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_staff_tenant_biometric (tenant_id, biometric_user_no);

ALTER TABLE hr_policy_versions
  ADD COLUMN IF NOT EXISTS work_start_time TIME NOT NULL DEFAULT '11:00:00',
  ADD COLUMN IF NOT EXISTS work_end_time TIME NOT NULL DEFAULT '18:30:00',
  ADD COLUMN IF NOT EXISTS morning_permit_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS evening_permit_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS morning_permits_per_month TINYINT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS evening_permits_per_month TINYINT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS late_tiers_json VARCHAR(500) NOT NULL DEFAULT '[{"over":10,"days":0.25},{"over":30,"days":0.5},{"over":120,"days":1}]',
  ADD COLUMN IF NOT EXISTS early_leave_tiered TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS early_leave_minutes INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_days DECIMAL(4,2) NULL,
  ADD COLUMN IF NOT EXISTS permit_used VARCHAR(16) NULL,
  ADD COLUMN IF NOT EXISTS punches_json VARCHAR(1000) NULL,
  ADD COLUMN IF NOT EXISTS review_flag VARCHAR(32) NULL;
