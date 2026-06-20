-- Refund / dispute workflow 2026-06-20 (Money risk #9).
-- NOTE: a richer `branches` table already exists in prod (branch_key, slug, label,
-- branch_type, timezone, currency, modules_json, tabs_json, per-tenant) — so the
-- dynamic-branches goal is already met; this migration only adds refunds.

CREATE TABLE IF NOT EXISTS refunds (
  id            VARCHAR(64)  NOT NULL PRIMARY KEY,
  tenant_id     VARCHAR(64)  NOT NULL DEFAULT 'mahad',
  payment_id    VARCHAR(64)  NOT NULL,
  subscriber_id VARCHAR(64)  NULL,
  amount        DECIMAL(12,2) NOT NULL,
  currency      VARCHAR(8)   NOT NULL DEFAULT 'EGP',
  reason        VARCHAR(500) NULL,
  status        ENUM('requested','approved','rejected','done') NOT NULL DEFAULT 'requested',
  requested_by  VARCHAR(120) NULL,
  approved_by   VARCHAR(120) NULL,
  journal_posted TINYINT(1)  NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at   TIMESTAMP    NULL,
  INDEX idx_refund_payment (payment_id),
  INDEX idx_refund_status (tenant_id, status)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
