-- Dynamic branches + refund workflow 2026-06-20 (Scalability #6, Money risk #9).

-- Branches as data (not a hard-coded enum) so new branches/franchises can be
-- added without a code change. Seeded from the current enum; the subscribers/
-- payments `branch` columns keep working (FK-free, soft reference by key).
CREATE TABLE IF NOT EXISTS branches (
  branch_key  VARCHAR(40)  NOT NULL,
  tenant_id   VARCHAR(64)  NOT NULL DEFAULT 'mahad',
  label_ar    VARCHAR(120) NOT NULL,
  label_en    VARCHAR(120) NULL,
  kind        ENUM('physical','online') NOT NULL DEFAULT 'physical',
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, branch_key)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO branches (branch_key, tenant_id, label_ar, kind, sort_order) VALUES
  ('DAQQI','mahad','فرع الدقي','physical',1),
  ('TAGAMOA','mahad','فرع التجمع','physical',2),
  ('ONLINE_EGYPT','mahad','أونلاين محلي (مصر)','online',3),
  ('ONLINE_SAUDI','mahad','أونلاين سعودي','online',4),
  ('ONLINE_ABROAD','mahad','أونلاين دولي','online',5),
  ('OTHER','mahad','أخرى','physical',6)
ON DUPLICATE KEY UPDATE label_ar=VALUES(label_ar);

-- Refund / dispute workflow. A refund reverses a payment in the ledger on approval.
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
