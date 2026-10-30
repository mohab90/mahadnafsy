-- The follow-up day is read from leads.next_follow_up_date alone from now on (30 Oct 2026).
--
-- Every filter and count (the bell, the follow-ups drawer, the reminders, the sales hub, the lead table's «متابعات» windows)
-- used «the column, else crm_json's nextFollowUpDate». The fallback made the database parse the crm_json of every lead that has
-- no date — 120,000 of the lab's 150,000 — and left no way to use an index on the date: 650 ms per count, five counts on the
-- sales hub. Every writer sets both (leads/write.js, crm-advanced.js, leadInteractions.js); migration 180 copied the old ones.
-- This copies any that slipped through since (same rule as 180: only a value that starts with a real date), so the column is
-- complete before the reads stop looking at the JSON.
UPDATE leads
SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d')
WHERE next_follow_up_date IS NULL
  AND crm_json LIKE '%nextFollowUpDate%'
  AND JSON_VALID(crm_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';
