-- ══════════════════════════════════════════════════════════════
-- 008_money_decimal_and_payroll_fix.sql
-- ══════════════════════════════════════════════════════════════
-- 1) Converts all monetary columns from DOUBLE to DECIMAL(12,2).
--    DOUBLE is binary floating point: sums of payments/expenses drift
--    by fractions of a piaster and financial reports stop reconciling.
--    DECIMAL stores exact values. Existing values are rounded to 2dp
--    on conversion (safe: all business amounts are 2dp).
-- 2) Adds consultations.assigned_staff_id used by payroll
--    (api/routes/hr.js instructor consultation earnings) — the column
--    was referenced by code but never created, so earnings were
--    silently 0.
--
-- Run AFTER 007_consolidated_runtime_schema.sql.
-- ══════════════════════════════════════════════════════════════

-- ── Catalog prices ───────────────────────────────────────────────
ALTER TABLE courses
  MODIFY price_egp      DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_sar      DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_usd      DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_egp DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_sar DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_usd DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE bundles
  MODIFY price_egp      DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_sar      DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_usd      DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_egp DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_sar DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_usd DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE therapists
  MODIFY price_egp DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_sar DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_usd DECIMAL(12,2) NOT NULL DEFAULT 0;

-- ── Money movement tables ────────────────────────────────────────
ALTER TABLE payments
  MODIFY amount          DECIMAL(12,2) NOT NULL,
  MODIFY course_expected DECIMAL(12,2) DEFAULT NULL,
  MODIFY discount        DECIMAL(12,2) DEFAULT NULL;

ALTER TABLE orders
  MODIFY amount DECIMAL(12,2) NOT NULL;

ALTER TABLE expenses
  MODIFY amount DECIMAL(12,2) NOT NULL;

ALTER TABLE consultations
  MODIFY amount DECIMAL(12,2) DEFAULT NULL;

ALTER TABLE certificate_requests
  MODIFY price       DECIMAL(12,2) DEFAULT NULL,
  MODIFY paid_amount DECIMAL(12,2) DEFAULT NULL;

ALTER TABLE payment_proofs
  MODIFY amount DECIMAL(12,2) NOT NULL;

ALTER TABLE daqqi_attendees
  MODIFY amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE subscribers
  MODIFY discount DECIMAL(12,2) DEFAULT NULL;

-- ── Percentage columns (rates, not amounts) ──────────────────────
ALTER TABLE staff
  MODIFY commission_rate DECIMAL(5,2) DEFAULT NULL;

ALTER TABLE discount_rules
  MODIFY discount_percent DECIMAL(5,2) NOT NULL;

-- ── Payroll fix: column referenced by hr.js but never created ────
ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS assigned_staff_id VARCHAR(36) DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_consult_assigned_staff (assigned_staff_id);
