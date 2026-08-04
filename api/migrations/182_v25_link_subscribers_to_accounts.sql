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
--
-- uq_subscribers_tenant_firebase means one account can only ever be linked to
-- one subscriber. The NOT EXISTS guard below only catches a link already made
-- BEFORE this statement runs — it cannot see two subscriber rows this SAME
-- UPDATE is about to link to the SAME account, since the subquery reads a
-- snapshot rather than the in-flight batch. Found rehearsing against a real
-- production snapshot: one account's number matched two real subscriber
-- records (a company-alias email and a personal email for the same person),
-- which aborted the migration the same way an already-linked account would.
-- The `ambiguous` derived table excludes any account matched by more than one
-- eligible subscriber, rather than guessing which one is authoritative — the
-- same safe-skip an unresolved account already falls back to (email lookup,
-- or the on-the-fly repair in subscriberIdentity.js on next sign-in).
UPDATE subscribers s
  JOIN users u
    ON u.tenant_id = s.tenant_id
   AND u.phone IS NOT NULL
   AND REGEXP_REPLACE(s.phone, '[^0-9]', '') LIKE CONCAT('%', u.phone)
  LEFT JOIN (
    SELECT u2.id AS user_id
      FROM subscribers s2
      JOIN users u2
        ON u2.tenant_id = s2.tenant_id AND u2.phone IS NOT NULL
       AND REGEXP_REPLACE(s2.phone, '[^0-9]', '') LIKE CONCAT('%', u2.phone)
     WHERE s2.firebase_uid IS NULL AND s2.phone IS NOT NULL AND s2.deleted_at IS NULL
     GROUP BY u2.id
    HAVING COUNT(*) > 1
  ) ambiguous ON ambiguous.user_id = u.id
   SET s.firebase_uid = u.id
 WHERE s.firebase_uid IS NULL
   AND s.phone IS NOT NULL
   AND s.deleted_at IS NULL
   AND ambiguous.user_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM (SELECT tenant_id, firebase_uid FROM subscribers) AS taken
      WHERE taken.tenant_id = s.tenant_id
        AND taken.firebase_uid = u.id
   );

-- ── By email, for accounts that have one ─────────────────────────────────────
-- Same same-batch-collision reasoning as above, in case a data-quality issue
-- ever leaves two subscriber rows sharing one normalised email.
UPDATE subscribers s
  JOIN users u
    ON u.tenant_id = s.tenant_id
   AND u.email IS NOT NULL AND u.email <> ''
   AND LOWER(TRIM(u.email)) = LOWER(TRIM(s.email))
  LEFT JOIN (
    SELECT u2.id AS user_id
      FROM subscribers s2
      JOIN users u2
        ON u2.tenant_id = s2.tenant_id AND u2.email IS NOT NULL AND u2.email <> ''
       AND LOWER(TRIM(u2.email)) = LOWER(TRIM(s2.email))
     WHERE s2.firebase_uid IS NULL AND s2.email IS NOT NULL AND s2.email <> '' AND s2.deleted_at IS NULL
     GROUP BY u2.id
    HAVING COUNT(*) > 1
  ) ambiguous ON ambiguous.user_id = u.id
   SET s.firebase_uid = u.id
 WHERE s.firebase_uid IS NULL
   AND s.email IS NOT NULL AND s.email <> ''
   AND s.deleted_at IS NULL
   AND ambiguous.user_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM (SELECT tenant_id, firebase_uid FROM subscribers) AS taken
      WHERE taken.tenant_id = s.tenant_id
        AND taken.firebase_uid = u.id
   );

-- The phone lookup in subscriberIdentity.js compares s.phone with an indexed
-- equality (IN (...)) rather than a function, so it needs the index to exist.
ALTER TABLE IF EXISTS subscribers
  ADD INDEX IF NOT EXISTS idx_subscribers_tenant_phone (tenant_id, phone);
