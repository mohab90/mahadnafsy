-- Management-published offers the sales team sells against: a discount off the
-- price, or a bonus/uplift the rep can add.
--
-- Scope is one row, not a join table, because an offer targets exactly one of:
-- a single course, every course, a single bundle, every bundle, or a branch.
-- `scope_id` carries the course/bundle/branch key for the singular scopes and
-- is NULL for the "all" ones.
CREATE TABLE IF NOT EXISTS sales_offers (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  kind ENUM('discount','bonus') NOT NULL DEFAULT 'discount',
  value_type ENUM('percent','amount') NOT NULL DEFAULT 'percent',
  value DECIMAL(12,2) NOT NULL DEFAULT 0,
  scope_type ENUM('course','all_courses','bundle','all_bundles','branch') NOT NULL DEFAULT 'all_courses',
  scope_id VARCHAR(64) DEFAULT NULL,
  starts_on DATE DEFAULT NULL,
  ends_on DATE DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_offers_tenant_active (tenant_id, is_active, ends_on),
  INDEX idx_offers_tenant_scope (tenant_id, scope_type, scope_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
