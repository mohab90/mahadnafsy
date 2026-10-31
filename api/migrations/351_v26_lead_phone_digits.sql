-- Whether a number is already a lead was answered by REGEXP_REPLACE(phone,'[^0-9]','') IN (...) over the whole table: 0.84 s at 150,000 leads
-- (about 3 s at the 520,000 production holds), inside the transaction that files a public lead and while holding a pooled connection. Forty
-- lead forms at once (a campaign) therefore held every connection and answered 500 or timed out — the failure CI's burst smoke exists for, and
-- it reproduced on origin/main at that size. The same digits are now a VIRTUAL column with an index: nothing is stored per row, the index is
-- built once (about 2 s at 150,000 leads), and a lookup reads a handful of entries. Every spelling of a number still matches (lib/leadMatching.js
-- leadPhoneClause), including +20 / spaces / dashes stored by old imports.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS phone_digits VARCHAR(64) AS (REGEXP_REPLACE(phone,'[^0-9]','')) VIRTUAL,
  ADD INDEX IF NOT EXISTS idx_leads_tenant_phone_digits (tenant_id, phone_digits);
