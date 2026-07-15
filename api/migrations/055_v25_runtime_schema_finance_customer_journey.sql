-- Centralises high-risk runtime schema dependencies used by payment, CRM,
-- customer journey, finance, LMS, and permissions flows.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_value DECIMAL(12,2) DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score INT NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_json LONGTEXT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS client_type VARCHAR(50) DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_sales_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_sales_name VARCHAR(255) DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_cs_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_cs_name VARCHAR(255) DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS hidden TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_source VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_content VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_term VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_url TEXT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS retargeting_sent_at DATETIME NULL;
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_score (score);
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_assigned_sales (assigned_sales_id);
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_assigned_cs (assigned_cs_id);
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_status (status);
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_phone (phone(20));
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_retargeting_sent_at (retargeting_sent_at);
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_hidden (hidden);

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS crm_json LONGTEXT NULL;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS client_type VARCHAR(50) DEFAULT NULL;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS assigned_sales_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS assigned_sales_name VARCHAR(255) DEFAULT NULL;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS assigned_cs_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS assigned_cs_name VARCHAR(255) DEFAULT NULL;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS referred_by VARCHAR(20) DEFAULT NULL;
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subs_sales (assigned_sales_id);
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subs_cs_id (assigned_cs_id);
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subs_phone (phone(20));

ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login DATETIME NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS linked_transfer_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at DATETIME DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS staff_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS staff_name VARCHAR(255) DEFAULT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS status ENUM('pending','paid','failed') NOT NULL DEFAULT 'paid';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_name VARCHAR(255) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS from_account VARCHAR(255) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS item_title VARCHAR(500) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cert_type VARCHAR(255) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS branch VARCHAR(50) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) DEFAULT 'tenant-default';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(191) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_staff (staff_id);
ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_txn_id (transaction_id);
ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_branch (branch);
ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_pay_staff_date (staff_id, date, status);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS amount_before_vat DECIMAL(12,2) DEFAULT NULL;

ALTER TABLE courses ADD COLUMN IF NOT EXISTS max_students INT UNSIGNED NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS description TEXT NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS short_description TEXT NULL;

ALTER TABLE course_lectures ADD COLUMN IF NOT EXISTS description TEXT NULL;
ALTER TABLE course_lectures ADD COLUMN IF NOT EXISTS is_preview TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE course_lectures ADD COLUMN IF NOT EXISTS is_published TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE course_lectures ADD COLUMN IF NOT EXISTS drip_unlock_days INT NOT NULL DEFAULT 0;
ALTER TABLE course_lectures ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS payment_links (
  id VARCHAR(36) PRIMARY KEY,
  token VARCHAR(128) UNIQUE NOT NULL,
  item_type ENUM('course','bundle','consultation') NOT NULL,
  item_id VARCHAR(100) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  customer_email VARCHAR(255) NULL,
  status ENUM('pending','paid','expired','cancelled') NOT NULL DEFAULT 'pending',
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_payment_links_token (token),
  INDEX idx_payment_links_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales_targets (
  id VARCHAR(36) PRIMARY KEY,
  staff_id VARCHAR(36) NOT NULL,
  month INT NOT NULL,
  year INT NOT NULL,
  target_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  target_leads INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_sales_target_staff_period (staff_id, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS course_waitlist (
  id VARCHAR(36) PRIMARY KEY,
  course_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) NULL,
  email VARCHAR(255) NULL,
  status ENUM('waiting','notified','enrolled','cancelled') NOT NULL DEFAULT 'waiting',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_waitlist_course (course_id),
  INDEX idx_waitlist_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS forum_posts (
  id VARCHAR(36) PRIMARY KEY,
  author_id VARCHAR(36) NOT NULL,
  author_name VARCHAR(200) NULL,
  course_id VARCHAR(36) NULL,
  title VARCHAR(255) NULL,
  body TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_forum_course (course_id),
  INDEX idx_forum_author (author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS forum_upvotes (
  post_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, subscriber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_history (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NULL,
  email VARCHAR(255) NULL,
  ip VARCHAR(64) NULL,
  user_agent TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_history_email (email),
  INDEX idx_login_history_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_notifications (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(50) DEFAULT 'info',
  title VARCHAR(255) NULL,
  message TEXT NULL,
  data_json TEXT NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_notifications_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reminder_log (
  id VARCHAR(36) PRIMARY KEY,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  channel VARCHAR(30) NOT NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_reminder (entity_type, entity_id, channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sms_settings (
  id VARCHAR(36) PRIMARY KEY,
  provider VARCHAR(100) NULL,
  config_json TEXT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
