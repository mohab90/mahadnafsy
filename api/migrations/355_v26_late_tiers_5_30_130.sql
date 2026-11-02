-- The owner's lateness rule (2 Nov 2026): the day is 11:00 to 18:30; arriving more than 5 minutes late costs 2 hours (a quarter of the 8-hour day), more than 30 minutes
-- costs 4 hours (a half), more than 130 minutes the whole day. It was 10 / 30 / 120. Only a policy still on the old default is moved; one HR edited by hand is left alone.
ALTER TABLE hr_policy_versions ALTER COLUMN late_tiers_json SET DEFAULT '[{"over":5,"days":0.25},{"over":30,"days":0.5},{"over":130,"days":1}]';

UPDATE hr_policy_versions
   SET late_tiers_json = '[{"over":5,"days":0.25},{"over":30,"days":0.5},{"over":130,"days":1}]'
 WHERE late_tiers_json = '[{"over":10,"days":0.25},{"over":30,"days":0.5},{"over":120,"days":1}]';
