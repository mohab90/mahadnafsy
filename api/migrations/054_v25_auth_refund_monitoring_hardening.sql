-- V25 hardening: move auth/refund/monitoring schema out of request paths.
-- Safe to run multiple times on MySQL 8+/MariaDB versions that support IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(100) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  is_active TINYINT DEFAULT 1,
  login_count INT DEFAULT 0,
  last_login DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login DATETIME DEFAULT NULL;
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_users_last_login (last_login);

CREATE TABLE IF NOT EXISTS refund_requests (
  id VARCHAR(36) PRIMARY KEY,
  subscriber_id VARCHAR(64) NOT NULL,
  payment_id VARCHAR(64) DEFAULT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'EGP',
  reason TEXT,
  refund_method VARCHAR(100) DEFAULT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  admin_note TEXT DEFAULT NULL,
  resolved_at DATETIME DEFAULT NULL,
  resolved_by VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_refund_status_created (status, created_at),
  KEY idx_refund_subscriber (subscriber_id),
  KEY idx_refund_payment (payment_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS payment_id VARCHAR(64) DEFAULT NULL;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT NULL;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS resolved_at DATETIME DEFAULT NULL;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS resolved_by VARCHAR(255) DEFAULT NULL;
ALTER TABLE refund_requests ADD INDEX IF NOT EXISTS idx_refund_status_created (status, created_at);
ALTER TABLE refund_requests ADD INDEX IF NOT EXISTS idx_refund_payment (payment_id);

CREATE TABLE IF NOT EXISTS payment_audit_log (
  id VARCHAR(36) PRIMARY KEY,
  payment_id VARCHAR(64) DEFAULT NULL,
  action VARCHAR(80) DEFAULT NULL,
  old_status VARCHAR(50) DEFAULT NULL,
  new_status VARCHAR(50) DEFAULT NULL,
  amount DECIMAL(12,2) DEFAULT NULL,
  subscriber_id VARCHAR(64) DEFAULT NULL,
  actor VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_audit_log (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(100) DEFAULT NULL,
  action VARCHAR(80) NOT NULL,
  old_json JSON DEFAULT NULL,
  new_json JSON DEFAULT NULL,
  amount DECIMAL(12,2) DEFAULT NULL,
  actor VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE payment_audit_log ADD INDEX IF NOT EXISTS idx_payment_audit_payment_action (payment_id, action);
ALTER TABLE financial_audit_log ADD INDEX IF NOT EXISTS idx_fin_audit_entity_created (entity_type, entity_id, created_at);
