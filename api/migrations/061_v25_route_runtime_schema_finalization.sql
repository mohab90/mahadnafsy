-- Final compatibility pass for schema that used to be created from route imports.
-- Route files must not own DDL. Keep this migration idempotent and append-only.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS linked_transfer_id VARCHAR(36) DEFAULT NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_json LONGTEXT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_source VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_content VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_term VARCHAR(200) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_url TEXT NULL;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS crm_json LONGTEXT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_name VARCHAR(255) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS from_account VARCHAR(255) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS item_title VARCHAR(500) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cert_type VARCHAR(255) DEFAULT NULL;
ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_staff (staff_id);
ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_txn_id (transaction_id);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS amount_before_vat DECIMAL(12,2) DEFAULT NULL;

ALTER TABLE courses ADD COLUMN IF NOT EXISTS max_students INT UNSIGNED NULL;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS permissions_json TEXT DEFAULT NULL;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_target DECIMAL(12,2) DEFAULT NULL;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_target_type VARCHAR(10) DEFAULT NULL;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_leads_target INT DEFAULT NULL;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_bonus DECIMAL(12,2) DEFAULT NULL;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS preferences_json TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS lead_timeline (
  id VARCHAR(100) PRIMARY KEY,
  lead_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  description TEXT,
  meta_json TEXT,
  at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lt_lead (lead_id),
  INDEX idx_lt_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_code_counter (
  id INT PRIMARY KEY DEFAULT 1,
  next_value INT DEFAULT 10001
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO client_code_counter (id, next_value) VALUES (1, 10001);

CREATE TABLE IF NOT EXISTS payment_proofs (
  id VARCHAR(100) PRIMARY KEY,
  subscriber_id VARCHAR(100) NOT NULL,
  course_id VARCHAR(100) DEFAULT NULL,
  amount DOUBLE NOT NULL,
  currency ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  payment_method VARCHAR(50) NOT NULL DEFAULT 'instapay',
  proof_image MEDIUMTEXT DEFAULT NULL,
  note TEXT DEFAULT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  reviewer_id VARCHAR(100) DEFAULT NULL,
  reviewer_note TEXT DEFAULT NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME DEFAULT NULL,
  INDEX idx_pp_subscriber (subscriber_id),
  INDEX idx_pp_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daqqi_rounds (
  id VARCHAR(36) NOT NULL,
  code VARCHAR(50) NOT NULL DEFAULT '',
  course_id VARCHAR(36) NOT NULL DEFAULT '',
  instructor_id VARCHAR(100) DEFAULT NULL,
  instructor_name VARCHAR(255) NOT NULL DEFAULT '',
  reception_id VARCHAR(100) DEFAULT NULL,
  reception_name VARCHAR(255) NOT NULL DEFAULT '',
  day_of_week VARCHAR(20) NOT NULL DEFAULT '',
  start_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  time_slot ENUM('MORNING','NOON','EVENING') NOT NULL DEFAULT 'EVENING',
  status ENUM('NEW','ACTIVE','FINISHED') NOT NULL DEFAULT 'NEW',
  current_lecture INT NOT NULL DEFAULT 0,
  postponed_weeks_json TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_daqqi_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daqqi_attendees (
  round_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  phone VARCHAR(50) NOT NULL DEFAULT '',
  booked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amount_paid DOUBLE NOT NULL DEFAULT 0,
  attended_lectures INT NOT NULL DEFAULT 0,
  PRIMARY KEY (round_id, subscriber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  title VARCHAR(200) NOT NULL,
  amount_egp DECIMAL(12,2) NOT NULL,
  category VARCHAR(100),
  notes TEXT,
  frequency ENUM('monthly','quarterly','yearly') DEFAULT 'monthly',
  day_of_month TINYINT DEFAULT 1,
  is_active TINYINT(1) DEFAULT 1,
  last_run DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(200),
  INDEX idx_recurring_expenses_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE recurring_expenses ADD INDEX IF NOT EXISTS idx_recurring_expenses_tenant (tenant_id);

CREATE TABLE IF NOT EXISTS installment_plans (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
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
  KEY idx_inst_status (status),
  KEY idx_inst_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE installment_plans ADD INDEX IF NOT EXISTS idx_inst_tenant (tenant_id);

CREATE TABLE IF NOT EXISTS payment_links (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  token VARCHAR(128) UNIQUE NOT NULL,
  item_type ENUM('course','bundle','consultation') NOT NULL,
  item_id VARCHAR(100) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  subscriber_id VARCHAR(36) DEFAULT NULL,
  customer_email VARCHAR(255) NULL,
  description VARCHAR(500) DEFAULT NULL,
  status ENUM('pending','paid','expired','cancelled') NOT NULL DEFAULT 'pending',
  expires_at DATETIME NULL,
  used_at DATETIME DEFAULT NULL,
  created_by VARCHAR(100),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_payment_links_token (token),
  INDEX idx_payment_links_status (status),
  INDEX idx_payment_links_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS subscriber_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS description VARCHAR(500) DEFAULT NULL;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS used_at DATETIME DEFAULT NULL;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS created_by VARCHAR(100) DEFAULT NULL;
ALTER TABLE payment_links ADD INDEX IF NOT EXISTS idx_payment_links_tenant (tenant_id);

CREATE TABLE IF NOT EXISTS refund_requests (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
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
  INDEX idx_refund_subscriber (subscriber_id),
  INDEX idx_refund_status (status),
  INDEX idx_refund_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE refund_requests ADD INDEX IF NOT EXISTS idx_refund_tenant (tenant_id);

CREATE TABLE IF NOT EXISTS drip_campaigns (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  name VARCHAR(500) NOT NULL,
  trigger_event VARCHAR(255) NOT NULL DEFAULT 'subscription_created',
  audience ENUM('subscribers','leads','all') NOT NULL DEFAULT 'subscribers',
  status ENUM('active','paused','draft') NOT NULL DEFAULT 'draft',
  enrolled_count INT NOT NULL DEFAULT 0,
  completed_count INT NOT NULL DEFAULT 0,
  steps JSON NOT NULL DEFAULT ('[]'),
  created_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_drip_campaigns_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE drip_campaigns ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE drip_campaigns ADD INDEX IF NOT EXISTS idx_drip_campaigns_tenant (tenant_id);

CREATE TABLE IF NOT EXISTS sales_goals (
  id INT PRIMARY KEY AUTO_INCREMENT,
  period VARCHAR(7) NOT NULL,
  revenue_target DECIMAL(12,2) DEFAULT 0,
  leads_target INT DEFAULT 0,
  conversions_target INT DEFAULT 0,
  new_clients_target INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sales_goals_period (period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales_targets (
  staff_id VARCHAR(64) NOT NULL,
  period VARCHAR(7) NOT NULL,
  revenue_target DECIMAL(12,2) DEFAULT 0,
  leads_target INT DEFAULT 0,
  updated_by VARCHAR(64) DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (staff_id, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE sales_targets ADD COLUMN IF NOT EXISTS staff_id VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE sales_targets ADD COLUMN IF NOT EXISTS period VARCHAR(7) NOT NULL DEFAULT '';
ALTER TABLE sales_targets ADD COLUMN IF NOT EXISTS revenue_target DECIMAL(12,2) DEFAULT 0;
ALTER TABLE sales_targets ADD COLUMN IF NOT EXISTS leads_target INT DEFAULT 0;
ALTER TABLE sales_targets ADD COLUMN IF NOT EXISTS updated_by VARCHAR(64) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS drip_sequences (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  trigger_status VARCHAR(100),
  is_active TINYINT(1) DEFAULT 1,
  steps JSON,
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
  provider VARCHAR(50) DEFAULT 'vonage',
  api_key VARCHAR(255) DEFAULT '',
  api_secret VARCHAR(255) DEFAULT '',
  sender_id VARCHAR(50) DEFAULT 'MAHAD',
  is_active TINYINT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE sms_settings ADD COLUMN IF NOT EXISTS api_key VARCHAR(255) DEFAULT '';
ALTER TABLE sms_settings ADD COLUMN IF NOT EXISTS api_secret VARCHAR(255) DEFAULT '';
ALTER TABLE sms_settings ADD COLUMN IF NOT EXISTS sender_id VARCHAR(50) DEFAULT 'MAHAD';
ALTER TABLE sms_settings ADD COLUMN IF NOT EXISTS is_active TINYINT DEFAULT 0;

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
  subscriber_id VARCHAR(36) NOT NULL,
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

CREATE TABLE IF NOT EXISTS ip_whitelist (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ip VARCHAR(64) NOT NULL,
  label VARCHAR(255) DEFAULT NULL,
  added_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ip (ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_history (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id VARCHAR(100),
  email VARCHAR(255),
  ip VARCHAR(64),
  user_agent VARCHAR(512),
  status ENUM('success','failed','2fa_pending','2fa_success') DEFAULT 'success',
  failure_reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_history_email (email),
  INDEX idx_login_history_created (created_at),
  INDEX idx_login_history_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE login_history ADD COLUMN IF NOT EXISTS status ENUM('success','failed','2fa_pending','2fa_success') DEFAULT 'success';
ALTER TABLE login_history ADD COLUMN IF NOT EXISTS failure_reason VARCHAR(255) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS admin_notifications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  link VARCHAR(512),
  is_read TINYINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_notifications_read (is_read),
  INDEX idx_admin_notifications_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS link VARCHAR(512) DEFAULT NULL;
ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS is_read TINYINT DEFAULT 0;

CREATE TABLE IF NOT EXISTS reminder_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  type ENUM('followup','payment_due') NOT NULL,
  ref_id VARCHAR(64) NOT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_type_ref_day (type, ref_id, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_appraisals (
  id VARCHAR(36) PRIMARY KEY,
  staff_id VARCHAR(36) NOT NULL,
  reviewer_id VARCHAR(36) DEFAULT NULL,
  reviewer_email VARCHAR(200) NULL,
  period_month TINYINT NULL,
  period_year SMALLINT NULL,
  kpi_scores JSON NULL,
  overall_score DECIMAL(5,2) NULL,
  grade VARCHAR(10) NULL,
  score DECIMAL(5,2) DEFAULT NULL,
  notes TEXT,
  status ENUM('draft','submitted','approved') NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_perf_staff (staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE performance_appraisals ADD COLUMN IF NOT EXISTS reviewer_email VARCHAR(200) NULL;
ALTER TABLE performance_appraisals ADD COLUMN IF NOT EXISTS period_month TINYINT NULL;
ALTER TABLE performance_appraisals ADD COLUMN IF NOT EXISTS period_year SMALLINT NULL;
ALTER TABLE performance_appraisals ADD COLUMN IF NOT EXISTS kpi_scores JSON NULL;
ALTER TABLE performance_appraisals ADD COLUMN IF NOT EXISTS overall_score DECIMAL(5,2) NULL;
ALTER TABLE performance_appraisals ADD COLUMN IF NOT EXISTS grade VARCHAR(10) NULL;
ALTER TABLE performance_appraisals ADD COLUMN IF NOT EXISTS status ENUM('draft','submitted','approved') NOT NULL DEFAULT 'draft';
ALTER TABLE performance_appraisals ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE performance_appraisals ADD INDEX IF NOT EXISTS idx_pa_period (period_year, period_month);

CREATE TABLE IF NOT EXISTS course_waitlist (
  id VARCHAR(36) PRIMARY KEY,
  course_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) NULL,
  name VARCHAR(200) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(50) NULL,
  position INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('waiting','notified','enrolled','cancelled') NOT NULL DEFAULT 'waiting',
  notified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_waitlist_course (course_id),
  INDEX idx_waitlist_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE course_waitlist ADD COLUMN IF NOT EXISTS name VARCHAR(200) NULL;
ALTER TABLE course_waitlist ADD COLUMN IF NOT EXISTS phone VARCHAR(50) NULL;
ALTER TABLE course_waitlist ADD COLUMN IF NOT EXISTS position INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE course_waitlist ADD COLUMN IF NOT EXISTS notified_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS forum_posts (
  id VARCHAR(36) PRIMARY KEY,
  author_id VARCHAR(36) NOT NULL,
  author_name VARCHAR(200) NULL,
  course_id VARCHAR(36) NULL,
  parent_id VARCHAR(36) NULL,
  title VARCHAR(255) NULL,
  body TEXT NOT NULL,
  upvotes INT UNSIGNED NOT NULL DEFAULT 0,
  is_pinned TINYINT(1) NOT NULL DEFAULT 0,
  is_hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_forum_course (course_id),
  INDEX idx_forum_author (author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS parent_id VARCHAR(36) NULL;
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS upvotes INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS is_pinned TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS is_hidden TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE forum_posts ADD INDEX IF NOT EXISTS idx_fp_parent (parent_id);
ALTER TABLE forum_posts ADD INDEX IF NOT EXISTS idx_fp_pinned (is_pinned, created_at);

CREATE TABLE IF NOT EXISTS forum_upvotes (
  post_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, subscriber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  code VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_log (
  id VARCHAR(36) PRIMARY KEY,
  workflow_id VARCHAR(36) DEFAULT NULL,
  lead_id VARCHAR(100) DEFAULT NULL,
  subscriber_id VARCHAR(100) DEFAULT NULL,
  action VARCHAR(100) DEFAULT NULL,
  trigger_name VARCHAR(100) DEFAULT NULL,
  entity_type VARCHAR(80) DEFAULT NULL,
  entity_id VARCHAR(100) DEFAULT NULL,
  status ENUM('success','failed','skipped') NOT NULL DEFAULT 'success',
  message TEXT,
  triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_al_wf (workflow_id),
  INDEX idx_al_lead (lead_id),
  INDEX idx_automation_log_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS lead_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS subscriber_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS action VARCHAR(100) DEFAULT NULL;
ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE automation_log ADD INDEX IF NOT EXISTS idx_al_wf (workflow_id);
ALTER TABLE automation_log ADD INDEX IF NOT EXISTS idx_al_lead (lead_id);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY,
  subscriber_id VARCHAR(100) DEFAULT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'info',
  title VARCHAR(255) DEFAULT NULL,
  message TEXT DEFAULT NULL,
  data_json TEXT DEFAULT NULL,
  read_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_created (created_at),
  INDEX idx_notifications_read (read_at),
  INDEX idx_notifications_subscriber (subscriber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subscriber_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data_json TEXT DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at DATETIME DEFAULT NULL;
ALTER TABLE notifications MODIFY title VARCHAR(255) DEFAULT NULL;
