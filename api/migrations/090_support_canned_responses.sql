-- Admin-managed canned reply templates for the Customer-Service Hub.
CREATE TABLE IF NOT EXISTS support_canned_responses (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'عام',
  created_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_canned_tenant (tenant_id, category)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
