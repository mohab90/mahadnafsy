-- Extract small route-level runtime schema guards into a numbered migration.
-- Safe/idempotent: these objects also existed in older consolidated schema migrations,
-- but keeping them here makes upgrades explicit after removing route-load DDL.

CREATE TABLE IF NOT EXISTS refund_requests (
  id VARCHAR(36) PRIMARY KEY,
  subscriber_id VARCHAR(36) NOT NULL,
  payment_id VARCHAR(36) DEFAULT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'EGP',
  reason TEXT,
  status ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
  admin_note TEXT,
  refund_method VARCHAR(100) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME DEFAULT NULL,
  resolved_by VARCHAR(100) DEFAULT NULL,
  tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default',
  branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other',
  INDEX idx_subscriber (subscriber_id),
  INDEX idx_status (status),
  INDEX idx_refunds_tenant_branch (tenant_id, branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';
ALTER TABLE refund_requests ADD INDEX IF NOT EXISTS idx_refunds_tenant_branch (tenant_id, branch_id);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_source VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_content VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_term VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_url TEXT NULL;

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  title VARCHAR(200) NOT NULL,
  amount_egp DECIMAL(12,2) NOT NULL,
  category VARCHAR(100),
  notes TEXT,
  frequency ENUM('monthly','quarterly','yearly') DEFAULT 'monthly',
  day_of_month TINYINT DEFAULT 1,
  is_active TINYINT(1) DEFAULT 1,
  last_run DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ip_whitelist (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ip VARCHAR(64) NOT NULL,
  label VARCHAR(255) DEFAULT NULL,
  added_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ip (ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
