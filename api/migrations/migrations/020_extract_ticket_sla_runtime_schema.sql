-- Extract startupTasks v32 runtime schema into an idempotent migration.

ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_source (source);
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_status_created (status, created_at);
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_branch (branch);
ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_status_branch (status, branch);

ALTER TABLE support_tickets MODIFY COLUMN priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_hours INT DEFAULT 24;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS responded_at DATETIME NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolved_at DATETIME NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_breached TINYINT(1) DEFAULT 0;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS escalated_to VARCHAR(36) NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS escalated_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS canned_responses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4;
