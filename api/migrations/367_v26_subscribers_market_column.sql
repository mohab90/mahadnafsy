-- 6 Nov 2026, «تفريغ crm_json في جداول» one key at a time (the second after the client's status, 365): the online client's MARKET (local / saudi / intl) becomes a column.
-- It decides the client's tab, their currency and the collection officer who takes them, and lived only inside subscribers.crm_json, so asking the database who is a Saudi
-- client meant reading every client's whole blob. This migration only ADDS the column and COPIES the value (the release takes a database backup first); the key stays in
-- the blob for now and is removed from old rows by a later migration, once this one has run in production, as 359/360 and 365 did. Until then a reader takes the blob's key
-- when it is there (an older server writing during the release leaves its newest value there) and the column when it is not (lib/crmColumns.js).
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS market VARCHAR(10) NULL AFTER client_status;
UPDATE subscribers
   SET market = NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.market'))), '')
 WHERE market IS NULL AND JSON_VALID(crm_json) AND JSON_TYPE(JSON_EXTRACT(crm_json, '$.market')) = 'STRING';
