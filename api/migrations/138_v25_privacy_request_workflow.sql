CREATE TABLE IF NOT EXISTS tenant_privacy_policies (
  tenant_id VARCHAR(64) NOT NULL PRIMARY KEY,
  residency_region VARCHAR(40) NOT NULL DEFAULT 'not_configured',
  export_sla_days SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  erasure_sla_days SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  financial_retention_days SMALLINT UNSIGNED NOT NULL DEFAULT 2555,
  allow_self_service TINYINT(1) NOT NULL DEFAULT 1,
  updated_by VARCHAR(100) DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS privacy_requests (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  subscriber_id VARCHAR(64) NOT NULL,
  requester_user_id VARCHAR(100) DEFAULT NULL,
  requester_type ENUM('client','admin') NOT NULL DEFAULT 'client',
  request_type ENUM('export','erasure') NOT NULL,
  status ENUM('pending','processing','completed','rejected','blocked','failed') NOT NULL DEFAULT 'pending',
  reason VARCHAR(1000) DEFAULT NULL,
  decision_note VARCHAR(1000) DEFAULT NULL,
  legal_hold_reason VARCHAR(1000) DEFAULT NULL,
  due_at DATETIME NOT NULL,
  handled_by VARCHAR(100) DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  evidence_json JSON DEFAULT NULL,
  evidence_hash CHAR(64) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_privacy_requests_tenant_status_due (tenant_id, status, due_at),
  INDEX idx_privacy_requests_subject (tenant_id, subscriber_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
