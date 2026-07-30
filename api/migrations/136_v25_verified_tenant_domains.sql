CREATE TABLE IF NOT EXISTS tenant_domains (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  domain VARCHAR(253) NOT NULL,
  status ENUM('pending','verified') NOT NULL DEFAULT 'pending',
  verification_token_hash CHAR(64) NOT NULL,
  verified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_domains_tenant (tenant_id),
  UNIQUE KEY uq_tenant_domains_domain (domain),
  KEY idx_tenant_domains_verified (status, domain),
  CONSTRAINT fk_tenant_domains_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
