-- 7 Nov 2026, «تفريغ crm_json في جداول» one key at a time: a lead's next follow-up day (nextFollowUpDate) lives in leads.next_follow_up_date alone.
--
-- The column was added and filled in 180 and 349 and every filter, count and list has read it since (lib/leadFollowUps.js; mapLeadRow takes the column first). The writers
-- (routes/admin/leads/write.js, routes/crm-advanced.js, lib/leadInteractions.js) now set the column and no longer put a copy in the blob; this takes the old copies out, as 360
-- did for the clients' item money. Any lead whose blob still holds a date its column does not is copied to the column first (same rule as 349: only a value that starts with a
-- real date), so nothing is lost. updated_at is kept: nothing about the lead changed for a rep.
--
-- Rollback: nothing to undo for the screens (they read the column). The blob key can be rebuilt from the column: UPDATE leads SET crm_json = JSON_SET(crm_json, '$.nextFollowUpDate', DATE_FORMAT(next_follow_up_date, '%Y-%m-%d')) WHERE next_follow_up_date IS NOT NULL AND JSON_VALID(crm_json).

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET crm_json = JSON_REMOVE(crm_json, '$.nextFollowUpDate'), updated_at = updated_at
 WHERE crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_CONTAINS_PATH(crm_json, 'one', '$.nextFollowUpDate')
   -- a value that is not a date and has no column behind it (free text typed into the blob) is left where it is
   AND (next_follow_up_date IS NOT NULL
        OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), '') IN ('', 'null'));
