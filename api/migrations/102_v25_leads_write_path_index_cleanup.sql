-- 102: leads write-path index cleanup (scale prep for 100+ concurrent staff).
--
-- The leads table carries 24 secondary indexes. Every INSERT/UPDATE — and the
-- CRM is write-heavy (assignment, status changes, follow-ups, scoring) — must
-- maintain ALL of them, so redundant indexes are pure write tax that hurts most
-- exactly when many sales reps hammer the table at once. Two are provably
-- redundant duplicates and can go with zero read impact.
--
-- Idempotent (IF EXISTS) so the runner can re-apply safely. Same pattern as
-- migration 034, which did this for subscribers/users/payments.

-- 1) idx_leads_status_lower is byte-for-byte identical to idx_leads_status —
--    both are a single-column KEY on (status). Migration 038 added it under the
--    mistaken assumption that LOWER(status) lookups needed their own index;
--    they don't (status is stored lowercase + the collation is case-insensitive,
--    see the PERF-08 query fixes), so idx_leads_status already serves them.
DROP INDEX IF EXISTS idx_leads_status_lower ON leads;  -- idx_leads_status (identical) remains

-- 2) idx_leads_hidden (hidden) is a strict leftmost-prefix of
--    idx_leads_hidden_created (hidden, created_at). Any query that can use the
--    single-column index can use the composite one, so the single-column copy
--    is redundant.
DROP INDEX IF EXISTS idx_leads_hidden ON leads;  -- idx_leads_hidden_created (hidden,created_at) covers it
