-- ============================================================================
-- 009_foreign_keys.sql  —  Referential-integrity hardening (Critical Issue #5)
-- ============================================================================
-- ⚠️  DO NOT AUTO-RUN. This migration is MANUAL — apply only during a maintenance
--     window, AFTER the read-only integrity audit below returns ZERO orphan rows.
--
-- WHY MANUAL: the live DB has (a) possible orphan rows from years of app-level
-- integrity, and (b) inconsistent id column types (e.g. some subscriber_id are
-- VARCHAR(100), others VARCHAR(36)). A FOREIGN KEY requires the child column type
-- to EXACTLY match the parent PK type and have NO orphan rows, or the ALTER fails
-- and/or locks the table. So: audit → fix types → clean orphans → add FKs.
--
-- ROLLOUT ORDER:
--   1. Run STEP 1 (audit) — must all return 0 rows.
--   2. Run STEP 2 (type alignment) per column that mismatches.
--   3. Run STEP 3 (orphan cleanup) — review each before running.
--   4. Run STEP 4 (add FKs).
-- ============================================================================

-- ─── STEP 1 · INTEGRITY AUDIT (read-only — safe to run anytime) ───────────────
-- Each query lists orphan child rows whose parent no longer exists. All must be 0.

-- payments → subscribers
SELECT COUNT(*) AS orphan_payments_subscriber
FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id
WHERE p.subscriber_id IS NOT NULL AND s.id IS NULL;

-- subscribers → leads
SELECT COUNT(*) AS orphan_subscribers_lead
FROM subscribers su LEFT JOIN leads l ON l.id = su.lead_id
WHERE su.lead_id IS NOT NULL AND l.id IS NULL;

-- course_completions → subscribers / courses
SELECT COUNT(*) AS orphan_completions_subscriber
FROM course_completions cc LEFT JOIN subscribers s ON s.id = cc.subscriber_id
WHERE s.id IS NULL;

-- daqqi_attendees → daqqi_rounds  (adjust table/col names if they differ)
-- SELECT COUNT(*) AS orphan_attendees_round
-- FROM daqqi_attendees da LEFT JOIN daqqi_rounds r ON r.id = da.round_id
-- WHERE da.round_id IS NOT NULL AND r.id IS NULL;

-- ─── STEP 2 · TYPE ALIGNMENT (run only for mismatched columns) ────────────────
-- Parent PK subscribers.id is VARCHAR(36). Align any child columns that differ.
-- Verify current type first:  SHOW COLUMNS FROM payments LIKE 'subscriber_id';
-- ALTER TABLE payments MODIFY subscriber_id VARCHAR(36) DEFAULT NULL;

-- ─── STEP 3 · ORPHAN CLEANUP (review each row before deleting!) ───────────────
-- Prefer NULLing the link over deleting financial rows:
-- UPDATE payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id
--   SET p.subscriber_id = NULL WHERE p.subscriber_id IS NOT NULL AND s.id IS NULL;

-- ─── STEP 4 · ADD FOREIGN KEYS (after STEPS 1–3 pass) ─────────────────────────
-- ON DELETE SET NULL: child keeps its financial/audit record if parent is removed.
-- ON DELETE CASCADE : child is a true dependent with no standalone meaning.

-- ALTER TABLE payments
--   ADD CONSTRAINT fk_payments_subscriber FOREIGN KEY (subscriber_id)
--   REFERENCES subscribers(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ALTER TABLE subscribers
--   ADD CONSTRAINT fk_subscribers_lead FOREIGN KEY (lead_id)
--   REFERENCES leads(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ALTER TABLE course_completions
--   ADD CONSTRAINT fk_completion_subscriber FOREIGN KEY (subscriber_id)
--   REFERENCES subscribers(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- The statements above are intentionally COMMENTED OUT. Uncomment and run them
-- one-by-one during maintenance after the audit passes. See DEPLOY.md.
-- ============================================================================
