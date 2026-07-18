-- Ensure support tables and columns exist
CREATE TABLE IF NOT EXISTS support_messages (
    id VARCHAR(36) NOT NULL DEFAULT (UUID()),
    ticket_id VARCHAR(36) NOT NULL,
    author_type ENUM('subscriber','staff','system') NOT NULL DEFAULT 'staff',
    author_name VARCHAR(255) DEFAULT NULL,
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_sm_ticket (ticket_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_events (
    id VARCHAR(36) NOT NULL DEFAULT (UUID()),
    tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default',
    ticket_id VARCHAR(36) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    actor_id VARCHAR(36) DEFAULT NULL,
    actor_name VARCHAR(255) DEFAULT NULL,
    from_value VARCHAR(255) DEFAULT NULL,
    to_value VARCHAR(255) DEFAULT NULL,
    detail TEXT DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_te_ticket (ticket_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS converted_ticket_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS priority VARCHAR(50) DEFAULT 'medium';

-- Ensure support_tickets has all columns needed by support.js
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'general';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS department VARCHAR(100) DEFAULT 'support';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS channel VARCHAR(50) DEFAULT 'system';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) DEFAULT NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS source_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_due_at DATETIME DEFAULT NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS first_response_at DATETIME DEFAULT NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS first_response_by VARCHAR(36) DEFAULT NULL;

-- In case ticket_replies exists from 008, we can migrate data and drop it if needed,
-- but since we're ensuring support_messages, we'll leave ticket_replies alone to avoid data loss just in case.
