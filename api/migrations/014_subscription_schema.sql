-- Proper subscription / installment schema 2026-06-20 (Top10 #6, supports Top20 #12).
-- Replaces the installmentPlans blobs currently living inside subscribers.crm_json.
-- Backfilled by tools/backfill-crm-json.mjs; reads should migrate off crm_json.

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

CREATE TABLE IF NOT EXISTS installment_plans (
  id             VARCHAR(64)  NOT NULL PRIMARY KEY,
  tenant_id      VARCHAR(64)  NOT NULL DEFAULT 'mahad',
  subscriber_id  VARCHAR(64)  NOT NULL,
  course_id      VARCHAR(64)  NULL,
  bundle_id      VARCHAR(64)  NULL,
  total_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency       VARCHAR(8)   NOT NULL DEFAULT 'EGP',
  status         ENUM('active','completed','cancelled') NOT NULL DEFAULT 'active',
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_plan_tenant (tenant_id),
  INDEX idx_plan_subscriber (subscriber_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS installment_entries (
  id             VARCHAR(64)  NOT NULL PRIMARY KEY,
  plan_id        VARCHAR(64)  NOT NULL,
  tenant_id      VARCHAR(64)  NOT NULL DEFAULT 'mahad',
  due_date       DATE         NULL,
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid           TINYINT(1)   NOT NULL DEFAULT 0,
  paid_at        DATE         NULL,
  payment_id     VARCHAR(64)  NULL,
  INDEX idx_entry_plan (plan_id),
  INDEX idx_entry_due (tenant_id, due_date, paid)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
