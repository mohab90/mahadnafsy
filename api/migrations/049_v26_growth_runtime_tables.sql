CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  points INT NOT NULL,
  balance_after INT NOT NULL,
  reason VARCHAR(120) NOT NULL DEFAULT 'manual',
  reference_type VARCHAR(80) NULL,
  reference_id VARCHAR(100) NULL,
  created_by VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_loyalty_subscriber (subscriber_id, created_at),
  KEY idx_loyalty_reference (reference_type, reference_id),
  UNIQUE KEY uniq_loyalty_subscriber_reference (subscriber_id, reference_type, reference_id),
  KEY idx_loyalty_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  user_uid VARCHAR(100) NULL,
  subscriber_id VARCHAR(36) NULL,
  endpoint_hash CHAR(64) NOT NULL,
  subscription_json JSON NOT NULL,
  user_agent VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_sent_at DATETIME NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_push_endpoint_hash (endpoint_hash),
  KEY idx_push_subscriber (subscriber_id),
  KEY idx_push_uid (user_uid),
  KEY idx_push_active (is_active),
  KEY idx_push_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checkout_reminders (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  order_id VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(50) NULL,
  customer_email VARCHAR(255) NULL,
  channel VARCHAR(30) NOT NULL DEFAULT 'whatsapp',
  status ENUM('sent','skipped','failed') NOT NULL,
  reason VARCHAR(255) NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_checkout_reminder_order_channel (order_id, channel),
  KEY idx_checkout_reminders_status (status),
  KEY idx_checkout_reminders_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
