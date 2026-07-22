-- FAQ knowledge base (public self-service — reduces support ticket volume).
CREATE TABLE IF NOT EXISTS faq_entries (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  question VARCHAR(500) NOT NULL,
  answer TEXT NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'عام',
  sort_order INT NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_faq_tenant_pub (tenant_id, is_published, sort_order)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
