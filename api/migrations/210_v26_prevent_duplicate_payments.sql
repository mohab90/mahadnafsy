-- Stop the same payment being recorded twice.
--
-- Sixteen rows on production were byte-identical to another: same subscriber,
-- same amount, same day, same method, same transaction id, same note. 49,460
-- EGP recorded twice. They were removed and their journal entries reversed;
-- this is what stops them coming back.
--
-- The guard is a generated column holding a hash of what makes a payment
-- distinct, with a unique index over it. Two records of one real event collide
-- and the database refuses the second, whatever route inserted it — the
-- GET_LOCK in the payment route only protects the path that remembers to take
-- it, and a constraint protects every path including the ones not written yet.
--
-- Every distinguishing field is in the hash, deliberately. A genuine second
-- instalment differs in at least one of them: six groups on production differ
-- by transaction id, by course, or by note, and all six are real second
-- payments — سهر احمد ربيع paid 900 twice on 2026-05-07 against two different
-- courses with two different transfer numbers. A coarser key would have deleted
-- her money.
--
-- COALESCE throughout because NULL never equals NULL in an index, so a NULL
-- column would quietly let duplicates through — the exact hole this closes.
--
-- The column is NULL for soft-deleted rows, which exempts them from the unique
-- index (MySQL does not compare NULLs). That matters twice over: a row removed
-- as a duplicate must not block a later legitimate re-entry of the same
-- details, and the sixteen just removed must not collide with each other while
-- the index is being built.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS dedupe_key CHAR(64)
  GENERATED ALWAYS AS (
    IF(deleted_at IS NOT NULL, NULL,
      SHA2(CONCAT_WS('|',
        COALESCE(tenant_id, ''),
        COALESCE(subscriber_id, ''),
        COALESCE(CAST(amount AS CHAR), ''),
        COALESCE(CAST(DATE(date) AS CHAR), ''),
        COALESCE(payment_method, ''),
        COALESCE(transaction_id, ''),
        COALESCE(course_id, ''),
        COALESCE(bundle_id, ''),
        COALESCE(CAST(is_installment AS CHAR), ''),
        COALESCE(note, '')
      ), 256))
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_dedupe
  ON payments (dedupe_key);
