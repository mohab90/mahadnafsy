-- 180: finish moving lead fields out of crm_json into their columns (step 2).
--
-- Migration 103 did the assignment fields. Every remaining key the read path
-- still falls back to now has a real column, so this fills those columns from
-- crm_json wherever the column is empty.
--
-- Output-neutral by construction: GET /api/admin/leads resolves each of these as
-- `column || crm_json.<key>`, so writing the JSON value into the column cannot
-- change what any query returns. It only moves the source of truth onto the
-- indexed column, which is what has to be true before crm_json can be dropped
-- from the hot SELECT.
--
-- Scoped to text/decimal columns with JSON_VALID guards, so there is no cast
-- risk. Idempotent (only touches empty columns), safe to re-run.

-- branch carries a fixed ENUM. Older crm_json was written before that enum
-- existed, so it holds values that were never valid members — a literal
-- string "null" (from code that stringified a JS null instead of omitting
-- the key) and pre-normalization spellings like "online-egypt". Writing
-- either straight into the column aborts the whole migration under strict
-- mode ("Data truncated for column 'branch'") on any database old enough to
-- carry them — found by rehearsing this migration against a real production
-- snapshot before deploy, where it failed on exactly this. Normalize casing/
-- separators first, then only write values that land on an actual member.
UPDATE leads
SET branch = REPLACE(UPPER(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.branch'))), '-', '_')
WHERE (branch IS NULL OR branch = '')
  AND crm_json IS NOT NULL AND JSON_VALID(crm_json)
  AND REPLACE(UPPER(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.branch'))), '-', '_')
      IN ('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER');

UPDATE leads
SET client_code = JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.clientCode'))
WHERE (client_code IS NULL OR client_code = '')
  AND crm_json IS NOT NULL AND JSON_VALID(crm_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.clientCode')) IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.clientCode')) <> ''
  -- client_code carries a UNIQUE index; skip any value already taken so the
  -- backfill can never abort on a duplicate left behind by an old merge.
  AND NOT EXISTS (
    SELECT 1 FROM (SELECT client_code AS taken FROM leads) AS existing
     WHERE existing.taken = JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.clientCode'))
  );

UPDATE leads
SET interest_level = UPPER(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.interestLevel')))
WHERE (interest_level IS NULL OR interest_level = '')
  AND crm_json IS NOT NULL AND JSON_VALID(crm_json)
  AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.interestLevel'))) IN ('LOW','MEDIUM','HIGH');

UPDATE leads
SET deal_value = CAST(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.dealValue')) AS DECIMAL(10,2))
WHERE deal_value IS NULL
  AND crm_json IS NOT NULL AND JSON_VALID(crm_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.dealValue')) REGEXP '^[0-9]+(\\.[0-9]+)?$';

UPDATE leads
SET interested_course_ids_json = JSON_EXTRACT(crm_json, '$.interestedCourseIds')
WHERE (interested_course_ids_json IS NULL OR interested_course_ids_json = '')
  AND crm_json IS NOT NULL AND JSON_VALID(crm_json)
  AND JSON_TYPE(JSON_EXTRACT(crm_json, '$.interestedCourseIds')) = 'ARRAY';

-- Dates are only copied when they parse; a malformed string is left alone
-- rather than silently becoming NULL or the zero date.
--
-- Both target columns are DATETIME, and real crm_json has entries like
-- "2026-06-10 15:09" (date + time) alongside plain "2026-06-10" ones — under
-- strict mode STR_TO_DATE(..., '%Y-%m-%d') rejects the former outright
-- ("Truncated incorrect date value") because the format string doesn't
-- account for the trailing time, aborting the whole migration. Found the
-- same way as the branch fix above: rehearsing against a real production
-- snapshot. Taking just the leading 10 characters before parsing keeps the
-- date and drops the time-of-day, which matches what these columns' own
-- "_date"/"follow_up" naming already implies they're meant to hold; a plain
-- 10-character date string is unaffected by the LEFT().
UPDATE leads
SET next_follow_up_date = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')), 10), '%Y-%m-%d')
WHERE next_follow_up_date IS NULL
  AND crm_json IS NOT NULL AND JSON_VALID(crm_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.nextFollowUpDate')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE leads
SET last_follow_up = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.lastFollowUp')), 10), '%Y-%m-%d')
WHERE last_follow_up IS NULL
  AND crm_json IS NOT NULL AND JSON_VALID(crm_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.lastFollowUp')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';
