-- 8–9 Nov 2026, HR finished:
--   «تظهر الجمعه وتكتبه اجازه اسبوعيه ولو حد نزلها تحددها انها اوفر تايم … نحسب الاوفر تايم دا بيوم ولا يوم ونص ولا يومين»
--   «التارجيت بيكون كل 15 يوم … دا خاص بالمبيعات فقط اما الرسيبشن او التحصيل نظام شهري عادي»

-- A weekly day off that was worked is overtime: how many days' pay it is worth, per day (HR can change it), from the policy's default.
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS overtime_days DECIMAL(3,2) NULL DEFAULT NULL;
ALTER TABLE hr_policy_versions ADD COLUMN IF NOT EXISTS weekend_overtime_days DECIMAL(3,2) NOT NULL DEFAULT 1.00;

-- The night's automatic absence is the system's guess, not an entry by hand: its own source, so a fingerprint upload of the month replaces it.
ALTER TABLE attendance_logs MODIFY COLUMN source ENUM('FINGERPRINT_IMPORT','MANUAL_ENTRY','APP','AUTO_ABSENCE') NOT NULL DEFAULT 'FINGERPRINT_IMPORT';
UPDATE attendance_logs SET source = 'AUTO_ABSENCE'
 WHERE source = 'MANUAL_ENTRY' AND status = 'ABSENT' AND notes LIKE 'غياب تلقائي%';

-- The reps' booking ladder runs per half month (1–15 and 16 to the end), the collectors' stays monthly.
UPDATE tenant_settings SET config_json = JSON_SET(config_json, '$.salesPeriod', 'HALF_MONTH')
 WHERE section = 'bonus_plan' AND JSON_VALID(config_json);
