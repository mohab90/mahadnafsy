CREATE TABLE IF NOT EXISTS payment_intents (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  order_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  provider ENUM('manual','paymob') NOT NULL DEFAULT 'manual',
  amount DECIMAL(12,2) NOT NULL,
  currency ENUM('EGP','SAR','USD') NOT NULL,
  status ENUM('created','under_review','paid','failed','cancelled','expired') NOT NULL DEFAULT 'created',
  idempotency_hash CHAR(64) NOT NULL,
  active_order_guard VARCHAR(36)
    GENERATED ALWAYS AS (
      CASE WHEN status IN ('created','under_review') THEN order_id ELSE NULL END
    ) STORED,
  payment_id VARCHAR(100) NULL,
  failure_code VARCHAR(80) NULL,
  expires_at DATETIME NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_intent_idempotency (tenant_id,idempotency_hash),
  UNIQUE KEY uq_payment_intent_active_order (tenant_id,active_order_guard),
  KEY idx_payment_intent_subscriber (tenant_id,subscriber_id,created_at),
  KEY idx_payment_intent_status (tenant_id,status,expires_at),
  CONSTRAINT fk_payment_intent_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT chk_payment_intent_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_attempts (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  intent_id VARCHAR(36) NOT NULL,
  attempt_no SMALLINT UNSIGNED NOT NULL,
  provider ENUM('manual','paymob') NOT NULL DEFAULT 'manual',
  status ENUM('initialized','proof_submitted','succeeded','failed','cancelled','expired') NOT NULL,
  proof_id VARCHAR(100) NULL,
  payment_id VARCHAR(100) NULL,
  safe_reference VARCHAR(191) NULL,
  error_code VARCHAR(80) NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_attempt_number (tenant_id,intent_id,attempt_no),
  UNIQUE KEY uq_payment_attempt_proof (tenant_id,proof_id),
  KEY idx_payment_attempt_status (tenant_id,status,created_at),
  CONSTRAINT fk_payment_attempt_intent FOREIGN KEY (intent_id) REFERENCES payment_intents(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payment_proofs
  ADD COLUMN payment_intent_id VARCHAR(36) NULL AFTER order_id,
  ADD COLUMN payment_attempt_id VARCHAR(36) NULL AFTER payment_intent_id,
  ADD INDEX idx_payment_proof_intent (tenant_id,payment_intent_id),
  ADD UNIQUE KEY uq_payment_proof_attempt (tenant_id,payment_attempt_id),
  ADD CONSTRAINT fk_payment_proof_intent
    FOREIGN KEY (payment_intent_id) REFERENCES payment_intents(id) ON DELETE RESTRICT;

INSERT IGNORE INTO payment_intents
  (id,tenant_id,order_id,subscriber_id,provider,amount,currency,status,idempotency_hash,
   payment_id,failure_code,expires_at,created_by,created_at,updated_at)
SELECT UUID(),COALESCE(pp.tenant_id,'tenant-default'),pp.order_id,pp.subscriber_id,'manual',
       pp.amount,pp.currency,
       CASE pp.status WHEN 'APPROVED' THEN 'paid' WHEN 'REJECTED' THEN 'failed' ELSE 'under_review' END,
       SHA2(CONCAT('legacy-proof:',pp.id),256),
       CASE WHEN pp.status='APPROVED' THEN CONCAT('proof-',pp.id) ELSE NULL END,
       CASE WHEN pp.status='REJECTED' THEN 'PROOF_REJECTED' ELSE NULL END,
       DATE_ADD(COALESCE(pp.reviewed_at,pp.submitted_at,NOW()),INTERVAL 48 HOUR),
       'migration-172',COALESCE(pp.submitted_at,NOW()),COALESCE(pp.reviewed_at,pp.submitted_at,NOW())
  FROM payment_proofs pp
  JOIN orders o ON o.id=pp.order_id
 WHERE pp.order_id IS NOT NULL AND pp.payment_intent_id IS NULL;

UPDATE payment_proofs pp
JOIN payment_intents pi
  ON pi.tenant_id=COALESCE(pp.tenant_id,'tenant-default')
 AND pi.idempotency_hash=SHA2(CONCAT('legacy-proof:',pp.id),256)
SET pp.payment_intent_id=pi.id
WHERE pp.payment_intent_id IS NULL;

INSERT IGNORE INTO payment_attempts
  (id,tenant_id,intent_id,attempt_no,provider,status,proof_id,payment_id,safe_reference,error_code,metadata_json,created_at,updated_at)
SELECT UUID(),COALESCE(pp.tenant_id,'tenant-default'),pp.payment_intent_id,1,'manual',
       CASE pp.status WHEN 'APPROVED' THEN 'succeeded' WHEN 'REJECTED' THEN 'failed' ELSE 'proof_submitted' END,
       pp.id,
       CASE WHEN pp.status='APPROVED' THEN CONCAT('proof-',pp.id) ELSE NULL END,
       pp.id,
       CASE WHEN pp.status='REJECTED' THEN 'PROOF_REJECTED' ELSE NULL END,
       JSON_OBJECT('source','migration-172'),
       COALESCE(pp.submitted_at,NOW()),COALESCE(pp.reviewed_at,pp.submitted_at,NOW())
  FROM payment_proofs pp
 WHERE pp.payment_intent_id IS NOT NULL AND pp.payment_attempt_id IS NULL;

UPDATE payment_proofs pp
JOIN payment_attempts pa
  ON pa.tenant_id=COALESCE(pp.tenant_id,'tenant-default')
 AND pa.proof_id=pp.id
SET pp.payment_attempt_id=pa.id
WHERE pp.payment_attempt_id IS NULL;
