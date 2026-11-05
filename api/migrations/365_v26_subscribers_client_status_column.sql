-- 5 Nov 2026, «تفريغ crm_json في جداول» one key at a time: the client's STATUS (active, paused, refunded, finished, old_local, old_intl …) becomes a column.
-- It lived only inside subscribers.crm_json, so every view of the clients table had to read the whole blob of every client to know a client's status; as a column it is
-- indexed and a list can ask the database. This migration only ADDS the column and COPIES the value (the release takes a database backup first); the key stays in the
-- blob for now and is removed from old rows by a later migration, once this one has run in production, as client_item_money did (359 copied, 360 removed).
-- Until then a reader takes the blob's key when it is there (an older server writing during the release leaves its newest value there) and the column when it is not.
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS client_status VARCHAR(40) NULL AFTER client_type;
UPDATE subscribers
   SET client_status = NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.clientStatus'))), '')
 WHERE client_status IS NULL AND JSON_VALID(crm_json) AND JSON_TYPE(JSON_EXTRACT(crm_json, '$.clientStatus')) = 'STRING';
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subscribers_tenant_status (tenant_id, client_status);
