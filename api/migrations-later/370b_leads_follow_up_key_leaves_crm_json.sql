-- NOT a migration: this folder is not read by tools/migrate.cjs. Run it by hand (mysql < file) in the release AFTER migration 370 is live in production and the code of that
-- release has been running without a rollback; it is the second half of moving nextFollowUpDate out of leads.crm_json.
--
-- Before running it, in the same release: stop the three writers (routes/admin/leads/write.js, routes/crm-advanced.js, lib/leadInteractions.js) from writing the key, or the key
-- comes back on the next edit of a lead (harmless, but then this is not finished).
--
-- Only a lead whose column holds a date has its key removed, so nothing is lost; a value that is not a date and has no column behind it (free text typed into the blob) stays.
-- updated_at is kept. Rollback: UPDATE leads SET crm_json = JSON_SET(crm_json, '$.nextFollowUpDate', DATE_FORMAT(next_follow_up_date, '%Y-%m-%d')) WHERE next_follow_up_date IS NOT NULL AND JSON_VALID(crm_json).
-- It rewrites every lead that still has the key, with the leads triggers of 368 firing per row: time it on the lab first and, if it is more than a few seconds, run it by id range.

UPDATE leads
   SET crm_json = JSON_REMOVE(crm_json, '$.nextFollowUpDate'), updated_at = updated_at
 WHERE crm_json LIKE '%nextFollowUpDate%'
   AND JSON_VALID(crm_json)
   AND JSON_CONTAINS_PATH(crm_json, 'one', '$.nextFollowUpDate')
   AND (next_follow_up_date IS NOT NULL
        OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), '') IN ('', 'null'));
