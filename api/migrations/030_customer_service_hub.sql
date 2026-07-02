-- 030_customer_service_hub.sql
-- Customer-Service Hub: turn the disconnected inbox silos (support_tickets,
-- contact_messages, refund_requests) into ONE routed, SLA-tracked ticketing
-- workflow with cross-department routing + a full timeline.
-- Idempotent (ADD COLUMN / ADD INDEX IF NOT EXISTS — MariaDB 11.8). Additive only.

-- ── support_tickets: routing + SLA + provenance ──────────────────────────────
ALTER TABLE IF EXISTS support_tickets
  ADD COLUMN IF NOT EXISTS category         VARCHAR(40)  NOT NULL DEFAULT 'general'  COMMENT 'billing|technical|complaint|refund|course_access|sales_inquiry|consultation|certificate|general',
  ADD COLUMN IF NOT EXISTS department       VARCHAR(40)  DEFAULT NULL                COMMENT 'resolved routing dept: support|collection|accounting|sales|instruction|management|daqqi',
  ADD COLUMN IF NOT EXISTS channel          VARCHAR(30)  NOT NULL DEFAULT 'system'   COMMENT 'web_contact|user_dashboard|whatsapp|phone|system',
  ADD COLUMN IF NOT EXISTS source_type      VARCHAR(30)  DEFAULT NULL                COMMENT 'origin entity: contact_message|payment|enrollment|lead|subscriber',
  ADD COLUMN IF NOT EXISTS source_id        VARCHAR(36)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sla_due_at       DATETIME     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS first_response_at DATETIME    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS first_response_by VARCHAR(36) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS escalated_at     DATETIME     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS closed_reason    VARCHAR(255) DEFAULT NULL;

ALTER TABLE IF EXISTS support_tickets
  ADD INDEX IF NOT EXISTS idx_tickets_department (department),
  ADD INDEX IF NOT EXISTS idx_tickets_category (category),
  ADD INDEX IF NOT EXISTS idx_tickets_assigned (assigned_to),
  ADD INDEX IF NOT EXISTS idx_tickets_sla (sla_due_at),
  ADD INDEX IF NOT EXISTS idx_tickets_status_sla (status, sla_due_at),
  ADD INDEX IF NOT EXISTS idx_tickets_source (source_type, source_id);

-- ── contact_messages: give the website inbox a real workflow ──────────────────
ALTER TABLE IF EXISTS contact_messages
  ADD COLUMN IF NOT EXISTS priority            VARCHAR(10) NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS assigned_to         VARCHAR(36) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS converted_ticket_id VARCHAR(36) DEFAULT NULL;

ALTER TABLE IF EXISTS contact_messages
  ADD INDEX IF NOT EXISTS idx_contact_status (status),
  ADD INDEX IF NOT EXISTS idx_contact_assigned (assigned_to);

-- ── ticket_events: append-only timeline for every action on a ticket ─────────
CREATE TABLE IF NOT EXISTS ticket_events (
  id          VARCHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id   VARCHAR(36) NOT NULL DEFAULT 'tenant-default',
  ticket_id   VARCHAR(36) NOT NULL,
  event_type  VARCHAR(30) NOT NULL COMMENT 'created|assigned|routed|replied|status_changed|escalated|converted|linked|note',
  actor_id    VARCHAR(36)  DEFAULT NULL,
  actor_name  VARCHAR(255) DEFAULT NULL,
  from_value  VARCHAR(255) DEFAULT NULL,
  to_value    VARCHAR(255) DEFAULT NULL,
  detail      TEXT         DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tevents_ticket (ticket_id, created_at),
  KEY idx_tevents_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
