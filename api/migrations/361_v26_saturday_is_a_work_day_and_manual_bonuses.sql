-- 4 Nov 2026. «يوم السبت مش اجازه احنا شغالين»: the first HR policy (migration 127) named Friday AND Saturday as the weekend, so Saturday was never a day of the
-- month sheet: no absence, no lateness, no pay judged on it. The weekend is Friday only; a policy that names exactly Friday and Saturday is moved, one the
-- owner set to something else is left alone.
UPDATE hr_policy_versions
   SET weekend_days_json = JSON_ARRAY(5)
 WHERE JSON_LENGTH(weekend_days_json) = 2
   AND JSON_CONTAINS(weekend_days_json, '5')
   AND JSON_CONTAINS(weekend_days_json, '6');

-- «الغي كل المكافات اللي انت حطيتها احنا هنحطها مانيول»: the month sheet's required / reached / bonus rows (source MONTH_SHEET) are withdrawn with the columns; a payroll
-- run counts only APPROVED bonuses, so these stop counting the next time the month is calculated. Bonuses typed by HR (no source) are not touched.
UPDATE employee_bonuses
   SET status = 'REJECTED', reason = CONCAT(COALESCE(reason, ''), ' | سُحبت: المكافآت بتتسجل يدويًا')
 WHERE source = 'MONTH_SHEET' AND status IN ('PENDING', 'APPROVED');
