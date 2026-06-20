-- Subscription + installment normalization 2026-06-20 (Top10 #6, Top20 #12).
--
-- NOTE: an `installment_plans` table ALREADY EXISTS (created at runtime by
-- api/routes/analytics.js) and stores the schedule as JSON arrays
-- (installment_amounts / due_dates / paid_dates). We do NOT redefine it here —
-- that would clash with the live feature. Instead we add:
--   • subscriptions       : a first-class subscription record (new, no conflict)
--   • installment_entries : one row per scheduled installment, normalising the
--                           JSON arrays above. Populated by tools/backfill-crm-json.mjs.

CREATE TABLE IF NOT EXISTS subscriptions (
  id             VARCHAR(64)  NOT NULL PRIMARY KEY,
  tenant_id      VARCHAR(64)  NOT NULL DEFAULT 'mahad',
  subscriber_id  VARCHAR(64)  NOT NULL,
  course_id      VARCHAR(64)  NULL,
  bundle_id      VARCHAR(64)  NULL,
  status         ENUM('active','suspended','completed','cancelled') NOT NULL DEFAULT 'active',
  total_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency       VARCHAR(8)   NOT NULL DEFAULT 'EGP',
  started_at     DATE         NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sub_tenant (tenant_id),
  INDEX idx_sub_subscriber (subscriber_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Normalised installment schedule. plan_id references the existing
-- installment_plans.id (VARCHAR(36)). One row per installment.
CREATE TABLE IF NOT EXISTS installment_entries (
  id             VARCHAR(64)  NOT NULL PRIMARY KEY,
  plan_id        VARCHAR(64)  NOT NULL,
  tenant_id      VARCHAR(64)  NOT NULL DEFAULT 'mahad',
  seq            INT          NOT NULL DEFAULT 0,
  due_date       DATE         NULL,
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid           TINYINT(1)   NOT NULL DEFAULT 0,
  paid_at        DATE         NULL,
  payment_id     VARCHAR(64)  NULL,
  INDEX idx_entry_plan (plan_id),
  INDEX idx_entry_due (tenant_id, due_date, paid),
  UNIQUE KEY uniq_entry_plan_seq (plan_id, seq)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
