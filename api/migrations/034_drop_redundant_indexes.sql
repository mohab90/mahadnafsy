-- 034_drop_redundant_indexes.sql
-- Zero-risk index dedup: each index dropped here is fully redundant because an
-- IDENTICAL plain index, or a UNIQUE index on the exact same column(s), remains.
-- The optimizer keeps an equivalent index, so no query plan can change — the only
-- effect is faster writes + less space. Verified against live index metadata
-- 2026-07-11. Idempotent (IF EXISTS) so the runner can re-apply safely.
-- First migration applied through the new numbered-migration runner.

-- subscribers: two indexes on assigned_cs_id / assigned_sales_id / created_at → keep one each
DROP INDEX IF EXISTS idx_subs_cs_id           ON subscribers;  -- idx_subscribers_assigned_cs (identical) remains
DROP INDEX IF EXISTS idx_subs_sales           ON subscribers;  -- idx_subscribers_assigned_sales (identical) remains
DROP INDEX IF EXISTS idx_subscribers_created  ON subscribers;  -- idx_subscribers_created_at (identical) remains
-- subscribers: plain/dup index where a UNIQUE index on the same column remains
DROP INDEX IF EXISTS idx_subscribers_client_code ON subscribers;  -- uq_subs_code (UNIQUE) remains
DROP INDEX IF EXISTS idx_subscribers_email       ON subscribers;  -- uq_subs_email (UNIQUE) remains
DROP INDEX IF EXISTS idx_subs_phone              ON subscribers;  -- uq_subs_phone (UNIQUE) remains

-- users: duplicate UNIQUE index on email
DROP INDEX IF EXISTS email ON users;  -- uq_users_email (UNIQUE) remains

-- payments: plain index on transaction_id where the UNIQUE one remains
DROP INDEX IF EXISTS idx_payments_txn_id ON payments;  -- idx_payments_txn (UNIQUE) remains

-- payment_links / promo_codes / referral_codes: plain index where UNIQUE remains
DROP INDEX IF EXISTS idx_token      ON payment_links;   -- token (UNIQUE) remains
DROP INDEX IF EXISTS idx_promo_code ON promo_codes;     -- code (UNIQUE) remains
DROP INDEX IF EXISTS idx_ref_code   ON referral_codes;  -- code (UNIQUE) remains
