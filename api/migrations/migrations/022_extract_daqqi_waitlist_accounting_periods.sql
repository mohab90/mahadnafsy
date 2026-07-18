-- Extract startupTasks v33 runtime schema into an idempotent migration.

CREATE TABLE IF NOT EXISTS daqqi_waitlist (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255),
  course_id VARCHAR(36),
  course_name VARCHAR(255),
  notes TEXT,
  status ENUM('waiting','contacted','enrolled','cancelled') DEFAULT 'waiting',
  branch ENUM('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT 'DAQQI',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS accounting_periods (
  id VARCHAR(36) PRIMARY KEY,
  period_label VARCHAR(20) NOT NULL,
  opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  closed_by VARCHAR(100) NULL,
  summary_json TEXT NULL,
  status ENUM('open','closed') DEFAULT 'open'
) CHARACTER SET utf8mb4;
