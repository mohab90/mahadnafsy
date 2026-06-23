-- ============================================================================
-- 021_collation_default_and_subscription_fix.sql
-- Audit fixes: Critical #4 (collation mismatch), #5 (runtime-DDL drift root cause),
--              #6 (subscriber_subscriptions.subscriber_id wrong type).
-- ============================================================================
-- Apply with the resilient applier (idempotent, per-statement, tunnel-safe):
--     node tools/apply-migrations-resilient.mjs --from 021
--
-- WHY: ~40 tables are created at RUNTIME (routes/lib) with no explicit COLLATE.
-- On MariaDB the server default collation is utf8mb4_uca1400_ai_ci, so those
-- tables drift away from utf8mb4_unicode_ci and any cross-table string JOIN
-- (e.g. crm_commissions.staff_id = staff.id) fails with
-- ER_CANT_AGGREGATE_2COLLATIONS. Setting the DATABASE default collation makes
-- every FUTURE runtime CREATE TABLE inherit the correct collation, killing the
-- drift at its source. Existing tables are converted below + by
-- tools/fix-all-collations.mjs (dynamic, enumerates information_schema).
-- ============================================================================

-- 1) Stop the drift permanently: set the default collation for the current DB.
--    (No db-name → MySQL/MariaDB applies it to the connection's default schema,
--     so this is portable across environments without hard-coding the DB name.)
ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2) Convert the tables the audit found drifted (created at runtime w/o COLLATE).
--    CONVERT TO rewrites every CHAR/VARCHAR/TEXT column to the target collation.
--    1146 (table missing) is ignored by the applier if a feature was never used.
ALTER TABLE crm_commissions       CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE subscription_plans    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE subscriber_subscriptions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3) Fix the subscription FK type: subscribers.id is VARCHAR(36), so an INT
--    subscriber_id can never join it. (Table is the billing-scheduler feature;
--    any pre-existing INT values were already non-joinable, so no data is lost.)
ALTER TABLE subscriber_subscriptions MODIFY COLUMN subscriber_id VARCHAR(36) NOT NULL;
