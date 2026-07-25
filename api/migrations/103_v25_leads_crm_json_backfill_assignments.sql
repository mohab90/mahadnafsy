-- 103: backfill lead assignment columns from legacy crm_json (crm_json → relational, step 1).
--
-- Historically the CRM stored assignment fields inside the crm_json blob; the
-- relational columns were added later, and every read already resolves them as
-- `column || crm_json.<key>` (see GET /api/admin/leads). This backfill copies the
-- crm_json value into the column ONLY where the column is still empty.
--
-- Provably output-neutral: since reads already fall back to exactly this crm_json
-- value, filling the column with it cannot change what any query returns — it just
-- moves the source of truth onto the indexed column so crm_json can eventually be
-- dropped from hot SELECTs. Scoped to varchar columns only, so there is no type-cast
-- risk. Idempotent (WHERE column empty), safe to re-run.

UPDATE leads
SET assigned_sales_id = JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedSalesId'))
WHERE (assigned_sales_id IS NULL OR assigned_sales_id = '')
  AND crm_json IS NOT NULL
  AND JSON_VALID(crm_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedSalesId')) IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedSalesId')) <> '';

UPDATE leads
SET assigned_sales_name = JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedSalesName'))
WHERE (assigned_sales_name IS NULL OR assigned_sales_name = '')
  AND crm_json IS NOT NULL
  AND JSON_VALID(crm_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedSalesName')) IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedSalesName')) <> '';

UPDATE leads
SET assigned_cs_id = JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedCsId'))
WHERE (assigned_cs_id IS NULL OR assigned_cs_id = '')
  AND crm_json IS NOT NULL
  AND JSON_VALID(crm_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedCsId')) IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedCsId')) <> '';

UPDATE leads
SET assigned_cs_name = JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedCsName'))
WHERE (assigned_cs_name IS NULL OR assigned_cs_name = '')
  AND crm_json IS NOT NULL
  AND JSON_VALID(crm_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedCsName')) IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(crm_json, '$.assignedCsName')) <> '';
