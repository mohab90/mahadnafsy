-- V30 Dokki operations, rewritten for V26/MySQL with explicit admin routes.

CREATE TABLE IF NOT EXISTS physical_classrooms (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  branch_id VARCHAR(100) NULL,
  name VARCHAR(200) NOT NULL,
  capacity INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_physical_classrooms_branch (branch_id),
  KEY idx_physical_classrooms_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS classroom_bookings (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  classroom_id VARCHAR(36) NOT NULL,
  course_id VARCHAR(36) NULL,
  staff_id VARCHAR(36) NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  purpose VARCHAR(255) NULL,
  created_by VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_classroom_bookings_room_time (classroom_id, start_time, end_time),
  KEY idx_classroom_bookings_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS physical_checkins (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  branch_id VARCHAR(100) NULL,
  source VARCHAR(60) NOT NULL DEFAULT 'manual',
  checked_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_in_by VARCHAR(255) NULL,
  notes TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_physical_checkins_subscriber (subscriber_id, checked_in_at),
  KEY idx_physical_checkins_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_items (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) NULL,
  stock_quantity INT NOT NULL DEFAULT 0,
  unit VARCHAR(40) NULL,
  branch_id VARCHAR(100) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inventory_items_sku (sku),
  KEY idx_inventory_items_branch (branch_id),
  KEY idx_inventory_items_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  item_id VARCHAR(36) NOT NULL,
  type ENUM('IN','OUT','ADJUST') NOT NULL,
  quantity INT NOT NULL,
  reason VARCHAR(255) NULL,
  performed_by VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inventory_transactions_item (item_id, created_at),
  KEY idx_inventory_transactions_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
