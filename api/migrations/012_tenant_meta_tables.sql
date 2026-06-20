-- Per-tenant metadata 2026-06-20 (Top20 #3 #4 #5).
-- Feature flags, plan limits, and usage metering — all keyed by tenant_id.
-- Single-tenant today: one 'mahad' row seeds a generous default plan.

CREATE TABLE IF NOT EXISTS tenant_plans (
  tenant_id     VARCHAR(64)  NOT NULL PRIMARY KEY,
  plan_name     VARCHAR(64)  NOT NULL DEFAULT 'standard',
  max_staff     INT          NOT NULL DEFAULT 1000,
  max_students  INT          NOT NULL DEFAULT 1000000,
  max_courses   INT          NOT NULL DEFAULT 100000,
  max_storage_mb INT         NOT NULL DEFAULT 1000000,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenant_feature_flags (
  tenant_id   VARCHAR(64)  NOT NULL,
  flag_key    VARCHAR(100) NOT NULL,
  enabled     TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, flag_key)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenant_usage (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id   VARCHAR(64)  NOT NULL,
  metric      VARCHAR(100) NOT NULL,
  amount      BIGINT       NOT NULL DEFAULT 1,
  occurred_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_usage_tenant_metric (tenant_id, metric, occurred_at)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the default single-tenant plan.
INSERT INTO tenant_plans (tenant_id, plan_name) VALUES ('mahad', 'owner')
  ON DUPLICATE KEY UPDATE plan_name = plan_name;
