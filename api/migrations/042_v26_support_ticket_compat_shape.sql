ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS subscriber_email VARCHAR(255) DEFAULT NULL AFTER subscriber_id;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS subscriber_name VARCHAR(255) DEFAULT NULL AFTER subscriber_email;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS body TEXT DEFAULT NULL AFTER subject;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(36) DEFAULT NULL AFTER assigned_to_name;
ALTER TABLE support_tickets MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'open';
ALTER TABLE support_tickets MODIFY COLUMN priority VARCHAR(50) NOT NULL DEFAULT 'medium';
ALTER TABLE support_tickets MODIFY COLUMN channel VARCHAR(50) DEFAULT 'system';
ALTER TABLE support_tickets MODIFY COLUMN source_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE support_tickets MODIFY COLUMN description TEXT DEFAULT NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS responded_at DATETIME NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_breached TINYINT(1) DEFAULT 0;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS escalated_to VARCHAR(36) DEFAULT NULL;
UPDATE support_tickets
SET status = LOWER(COALESCE(status, 'open')),
    priority = LOWER(COALESCE(priority, 'medium')),
    channel = LOWER(COALESCE(channel, 'system')),
    body = COALESCE(body, description),
    description = COALESCE(description, body),
    assigned_to = COALESCE(assigned_to, assigned_to_id);
ALTER TABLE support_tickets ADD INDEX IF NOT EXISTS idx_support_email_created (subscriber_email, created_at);
