-- Extract additional startupTasks workflow/runtime schema into a versioned migration.
-- Keep startup runtime guards temporarily, but make these structures explicit for deploys.

CREATE TABLE IF NOT EXISTS ticket_replies (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  ticket_id VARCHAR(36) NOT NULL,
  author_type ENUM('subscriber','staff','system') NOT NULL DEFAULT 'staff',
  author_name VARCHAR(255) DEFAULT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tr_ticket (ticket_id)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS webhooks (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  name VARCHAR(255) NOT NULL,
  url VARCHAR(1000) NOT NULL,
  secret VARCHAR(255) DEFAULT NULL,
  events JSON NOT NULL DEFAULT ('[]'),
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_triggered_at DATETIME DEFAULT NULL,
  last_status INT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS budgets (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  month CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  category VARCHAR(255) NOT NULL,
  budgeted_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'EGP',
  notes VARCHAR(500) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_budget (month, category)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS nps_responses (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  subscriber_id VARCHAR(36) DEFAULT NULL,
  subscriber_email VARCHAR(255) DEFAULT NULL,
  score TINYINT UNSIGNED NOT NULL COMMENT '0-10',
  comment TEXT DEFAULT NULL,
  payment_id VARCHAR(36) DEFAULT NULL,
  sent_at DATETIME DEFAULT NULL,
  responded_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_nps_sub (subscriber_id)
) CHARACTER SET utf8mb4;

ALTER TABLE ticket_replies
  ADD INDEX IF NOT EXISTS idx_ticket_replies_created (created_at);

ALTER TABLE webhooks
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id,
  ADD INDEX IF NOT EXISTS idx_webhooks_tenant_active (tenant_id, is_active, created_at);

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL AFTER tenant_id,
  ADD INDEX IF NOT EXISTS idx_budgets_tenant_month (tenant_id, month);
