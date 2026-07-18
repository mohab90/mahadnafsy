-- Extract route-level operational schema guards into a numbered migration.
-- Idempotent and non-destructive. This reduces DB work at module-load time.

CREATE TABLE IF NOT EXISTS installment_plans (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  subscriber_id VARCHAR(100) NOT NULL,
  payment_id VARCHAR(100),
  title VARCHAR(200),
  total_amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'EGP',
  installments_count INT NOT NULL DEFAULT 3,
  paid_count INT DEFAULT 0,
  installment_amounts JSON,
  due_dates JSON,
  paid_dates JSON,
  status ENUM('active','completed','overdue','cancelled') DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(200),
  KEY idx_inst_sub (subscriber_id),
  KEY idx_inst_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS amount_before_vat DECIMAL(12,2) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS drip_sequences (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  trigger_status VARCHAR(100),
  is_active TINYINT(1) DEFAULT 1,
  steps JSON COMMENT 'Array of {delay_days, subject, body_html}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drip_enrollments (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  sequence_id VARCHAR(36) NOT NULL,
  lead_id VARCHAR(36),
  subscriber_id VARCHAR(100),
  email VARCHAR(200) NOT NULL,
  current_step INT DEFAULT 0,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  next_send_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  unsubscribed_at TIMESTAMP NULL,
  KEY idx_drip_next (next_send_at),
  KEY idx_drip_seq (sequence_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sms_settings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  provider VARCHAR(50) DEFAULT 'vonage' COMMENT 'vonage|infobip|custom',
  api_key VARCHAR(255) DEFAULT '',
  api_secret VARCHAR(255) DEFAULT '',
  sender_id VARCHAR(50) DEFAULT 'MAHAD',
  is_active TINYINT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  billing_cycle ENUM('monthly','quarterly','yearly') DEFAULT 'monthly',
  description TEXT,
  is_active TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_subscriptions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  subscriber_id VARCHAR(100) NOT NULL,
  plan_id INT NOT NULL,
  status ENUM('active','paused','cancelled','expired') DEFAULT 'active',
  start_date DATE NOT NULL,
  next_billing_date DATE NOT NULL,
  end_date DATE,
  auto_renew TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_next_billing (next_billing_date),
  INDEX idx_subscriber (subscriber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE subscriber_subscriptions MODIFY COLUMN subscriber_id VARCHAR(100) NOT NULL;

CREATE TABLE IF NOT EXISTS login_history (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id VARCHAR(100),
  email VARCHAR(255),
  ip VARCHAR(64),
  user_agent VARCHAR(512),
  status ENUM('success','failed','2fa_pending','2fa_success') DEFAULT 'success',
  failure_reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_created (created_at),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE login_history MODIFY COLUMN user_id VARCHAR(100);

CREATE TABLE IF NOT EXISTS admin_notifications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  type VARCHAR(50) NOT NULL COMMENT 'alert|info|warning|success',
  title VARCHAR(255) NOT NULL,
  message TEXT,
  link VARCHAR(512),
  is_read TINYINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_read (is_read),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reminder_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  type ENUM('followup','payment_due') NOT NULL,
  ref_id VARCHAR(64) NOT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_type_ref_day (type, ref_id, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_links (
  id VARCHAR(36) PRIMARY KEY,
  token VARCHAR(128) UNIQUE NOT NULL,
  item_type ENUM('course','bundle','consultation') NOT NULL,
  item_id VARCHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'EGP',
  subscriber_id VARCHAR(36) DEFAULT NULL,
  description VARCHAR(500) DEFAULT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME DEFAULT NULL,
  created_by VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token (token),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_log (
  id VARCHAR(100) PRIMARY KEY,
  workflow_id VARCHAR(100),
  lead_id VARCHAR(100),
  subscriber_id VARCHAR(100),
  action VARCHAR(100),
  triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_al_wf (workflow_id),
  INDEX idx_al_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
