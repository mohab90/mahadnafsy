-- Client source must exist on subscribers because admin export, maintenance,
-- and client-list views read it directly. Backfill from crm_json when available.

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS source VARCHAR(120) DEFAULT NULL;
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subscribers_source (source);

UPDATE subscribers
SET source = COALESCE(
  NULLIF(source, ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.source')), ''),
  'web'
)
WHERE source IS NULL OR source = '';
