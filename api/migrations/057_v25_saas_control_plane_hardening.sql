-- Re-applies the modern SaaS control-plane after the historical baseline so
-- existing databases always have tenants/plans/subscriptions/flags/settings.

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  slug VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status ENUM('active','suspended','archived') NOT NULL DEFAULT 'active',
  plan_key VARCHAR(120) DEFAULT NULL,
  default_locale VARCHAR(20) NOT NULL DEFAULT 'ar-EG',
  default_timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Cairo',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenants_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saas_plans (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  plan_key VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL,
  billing_cycle ENUM('monthly','quarterly','yearly','custom') NOT NULL DEFAULT 'monthly',
  base_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  feature_limits_json JSON DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_saas_plans_key (plan_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  plan_id VARCHAR(36) DEFAULT NULL,
  status ENUM('trialing','active','past_due','cancelled','expired') NOT NULL DEFAULT 'trialing',
  starts_at DATETIME DEFAULT NULL,
  ends_at DATETIME DEFAULT NULL,
  trial_ends_at DATETIME DEFAULT NULL,
  metadata_json JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant_subscriptions_tenant (tenant_id),
  KEY idx_tenant_subscriptions_plan (plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feature_flags (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(36) DEFAULT NULL,
  flag_key VARCHAR(160) NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  config_json JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_feature_flags_tenant_key (tenant_id, flag_key),
  KEY idx_feature_flags_key (flag_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenant_settings (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  section VARCHAR(120) NOT NULL,
  config_json JSON NOT NULL,
  is_secret TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_settings_section (tenant_id, section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tenants (id, slug, name, status, plan_key)
VALUES ('tenant-default', 'mahad-nafsy', 'Mahad Nafsy', 'active', 'enterprise-local')
ON DUPLICATE KEY UPDATE status=VALUES(status), plan_key=VALUES(plan_key);

INSERT INTO saas_plans (id, plan_key, name, billing_cycle, base_price, currency, feature_limits_json, is_active)
VALUES ('plan-enterprise-local', 'enterprise-local', 'Enterprise Local', 'custom', 0, 'EGP', JSON_OBJECT('branches', 10, 'staff', 100, 'courses', 500), 1)
ON DUPLICATE KEY UPDATE name=VALUES(name), feature_limits_json=VALUES(feature_limits_json), is_active=VALUES(is_active);

INSERT INTO tenant_subscriptions (id, tenant_id, plan_id, status, starts_at, metadata_json)
VALUES ('sub-tenant-default', 'tenant-default', 'plan-enterprise-local', 'active', NOW(), JSON_OBJECT('source', 'migration_057'))
ON DUPLICATE KEY UPDATE status=VALUES(status), plan_id=VALUES(plan_id);
