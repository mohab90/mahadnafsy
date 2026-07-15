ALTER TABLE payments MODIFY COLUMN id VARCHAR(100) NOT NULL;
ALTER TABLE crm_commissions MODIFY COLUMN payment_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE installment_entries MODIFY COLUMN payment_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE installment_plans MODIFY COLUMN payment_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE nps_responses MODIFY COLUMN payment_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE payment_audit_log MODIFY COLUMN payment_id VARCHAR(100) NOT NULL;
ALTER TABLE refunds MODIFY COLUMN payment_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE refund_requests MODIFY COLUMN payment_id VARCHAR(100) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS finance_outbox (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  event_type VARCHAR(120) NOT NULL,
  ref_type VARCHAR(120) DEFAULT NULL,
  ref_id VARCHAR(120) DEFAULT NULL,
  payload_json JSON DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  status ENUM('pending','processed','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_finance_outbox_status_next (status, next_attempt_at),
  KEY idx_finance_outbox_ref (ref_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
