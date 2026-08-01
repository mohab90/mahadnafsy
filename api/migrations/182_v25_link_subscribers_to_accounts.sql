-- 182: link every subscriber to its login account once, by number.
--
-- /api/me/* resolves "who is this client?" by email. Migration 181 made the
-- WhatsApp number a login identity, and a client whose subscriber record has no
-- email now gets `users.email = NULL` — so the email lookup matches nothing and
-- the client signs in successfully to a completely empty account: no courses, no
-- progress, no certificates, while all of it sits untouched in the database.
--
-- api/lib/subscriberIdentity.js resolves by subscribers.firebase_uid first and
-- repairs the link on the fly, but only for clients who sign in. This backfills
-- everyone up front so the very first request after deploy is already an
-- indexed hit, and so admin-side joins can rely on the link existing.
--
-- REGEXP_REPLACE is fine here: it runs once, offline, not per request.

-- ── By number ────────────────────────────────────────────────────────────────
-- users.phone is already normalised (digits, no country code, no leading zero)
-- by migration 181, so match it against the tail of the subscriber's number,
-- which may be stored as 010…, +2010…, 002010… or bare.
UPDATE subscribers s
  JOIN users u
    ON u.tenant_id = s.tenant_id
   AND u.phone IS NOT NULL
   AND REGEXP_REPLACE(s.phone, '[^0-9]', '') LIKE CONCAT('%', u.phone)
   SET s.firebase_uid = u.id
 WHERE s.firebase_uid IS NULL
   AND s.phone IS NOT NULL
   AND s.deleted_at IS NULL
   -- uq_subscribers_tenant_firebase: never hand one account to two subscribers.
   AND NOT EXISTS (
     SELECT 1 FROM (SELECT tenant_id, firebase_uid FROM subscribers) AS taken
      WHERE taken.tenant_id = s.tenant_id
        AND taken.firebase_uid = u.id
   );

-- ── By email, for accounts that have one ─────────────────────────────────────
UPDATE subscribers s
  JOIN users u
    ON u.tenant_id = s.tenant_id
   AND u.email IS NOT NULL AND u.email <> ''
   AND LOWER(TRIM(u.email)) = LOWER(TRIM(s.email))
   SET s.firebase_uid = u.id
 WHERE s.firebase_uid IS NULL
   AND s.email IS NOT NULL AND s.email <> ''
   AND s.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM (SELECT tenant_id, firebase_uid FROM subscribers) AS taken
      WHERE taken.tenant_id = s.tenant_id
        AND taken.firebase_uid = u.id
   );

-- The phone lookup in subscriberIdentity.js compares s.phone with an indexed
-- equality (IN (...)) rather than a function, so it needs the index to exist.
ALTER TABLE IF EXISTS subscribers
  ADD INDEX IF NOT EXISTS idx_subscribers_tenant_phone (tenant_id, phone);
