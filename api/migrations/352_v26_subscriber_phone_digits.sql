-- A client who signs in is found by their number against subscribers.phone with an exact IN list of the spellings it is stored in
-- (lib/subscriberIdentity.js). A number stored in a spelling not on the list — spaces, dashes, a +, a different country prefix, as the
-- imports and staff entry wrote some — matched nobody, so the site opened an EMPTY account for a client who has a record, courses and
-- payments, and the admin search listed the sign-in as a separate «تسجيل دخول بالموقع». The digits of the number are now a VIRTUAL column
-- with an index (nothing stored per row; ~1 s at 30,000 clients), so the lookup matches whatever the spelling and still reads an index.
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS phone_digits VARCHAR(64) AS (REGEXP_REPLACE(phone,'[^0-9]','')) VIRTUAL,
  ADD INDEX IF NOT EXISTS idx_subs_tenant_phone_digits (tenant_id, phone_digits);
