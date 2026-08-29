-- 213_v26_drop_duplicate_indexes.sql
--
-- Seven indexes that duplicate another index on the exact same columns in the
-- same order. Each pair costs two index writes per row change and two copies in
-- the buffer pool to answer the questions one of them already answers.
--
-- 034_drop_redundant_indexes.sql did this once, on 2026-07-11. Later schema
-- migrations re-declared the same indexes with ADD INDEX IF NOT EXISTS, which
-- silently reintroduced what 034 had removed: 055 brought back the two on
-- subscribers, 182 the tenant/phone one, and 212 — the assignment-quota
-- migration — added idx_leads_assigned_at over the identical columns that 199
-- had already indexed as idx_leads_assigned_today.
--
-- No query plan can change: for every index dropped here, an index with the
-- same columns in the same order remains. Where one of the pair is UNIQUE, the
-- UNIQUE one is the one kept, so no constraint is weakened. Verified against
-- live index metadata 2026-08-30. Idempotent, so the runner can re-apply it.

-- subscribers: identical plain indexes, keep the longer-named pair
DROP INDEX IF EXISTS idx_subs_sales              ON subscribers;  -- idx_subscribers_assigned_sales (identical) remains
DROP INDEX IF EXISTS idx_subs_cs_id              ON subscribers;  -- idx_subscribers_assigned_cs (identical) remains
-- subscribers: plain index where a UNIQUE index on the same columns remains
DROP INDEX IF EXISTS idx_subscribers_tenant_phone ON subscribers; -- uq_subs_tenant_phone (UNIQUE) remains

-- enrollments: identical plain indexes
DROP INDEX IF EXISTS idx_enrollments_subscriber  ON enrollments;  -- idx_enroll_subscriber (identical) remains
DROP INDEX IF EXISTS idx_enrollments_course      ON enrollments;  -- idx_enroll_course (identical) remains
-- enrollments: plain index where a UNIQUE index on the same columns remains
DROP INDEX IF EXISTS idx_enroll_sub_course       ON enrollments;  -- uniq_enroll_sub_course (UNIQUE) remains

-- leads: introduced by 212 over columns 199 had already indexed
DROP INDEX IF EXISTS idx_leads_assigned_at       ON leads;        -- idx_leads_assigned_today (identical) remains
