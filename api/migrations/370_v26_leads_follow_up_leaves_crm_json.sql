-- 7 Nov 2026, «تفريغ crm_json في جداول» one key at a time: a lead's next follow-up day (nextFollowUpDate) is copied into leads.next_follow_up_date (same template as 365/367).
--
-- The column was added and filled in 180 and 349; every filter, count and list reads it, and mapLeadRow / the score formula take the column first. This copies the date of any
-- lead whose blob holds one the column does not (same rule as 349: only a value that starts with a real date). It changes no blob and keeps updated_at, so it is an addition
-- like 365 and 367: the code that was running before this release still finds the key in the blob after it, and a rollback of the code loses nothing.
--
-- One UPDATE per first character of the id (16 of them, each its own statement, so each its own short transaction): the whole copy is ~0.23 ms per lead that has the key on the lab
-- with the 368 triggers in place (100,000 leads: 23 s), and one statement over all of them would hold their row locks that long while the site is live. A range by id walks the primary
-- key, so a lead outside the range is not locked. The first range takes everything below '1' and the last everything from 'f' up, so no id is left out whatever it looks like.
--
-- The writers (routes/admin/leads/write.js, routes/crm-advanced.js, lib/leadInteractions.js) keep writing the key as well as the column for the same reason. Taking the key out of
-- the blob is a separate step for a LATER release, once this one is live and stable: migrations-later/370b_leads_follow_up_key_leaves_crm_json.sql (not run by the migration runner).

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id < '1'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= '1' AND id < '2'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= '2' AND id < '3'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= '3' AND id < '4'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= '4' AND id < '5'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= '5' AND id < '6'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= '6' AND id < '7'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= '7' AND id < '8'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= '8' AND id < '9'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= '9' AND id < 'a'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= 'a' AND id < 'b'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= 'b' AND id < 'c'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= 'c' AND id < 'd'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= 'd' AND id < 'e'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= 'e' AND id < 'f'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
   SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d'), updated_at = updated_at
 WHERE next_follow_up_date IS NULL AND id >= 'f'
   AND crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';
