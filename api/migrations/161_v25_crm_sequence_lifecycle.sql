-- Versioned, auditable CRM sales sequences.
ALTER TABLE drip_sequences
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1 AFTER steps,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Cairo' AFTER version,
  ADD COLUMN IF NOT EXISTS exit_on_reply TINYINT(1) NOT NULL DEFAULT 1 AFTER timezone,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD COLUMN IF NOT EXISTS updated_by VARCHAR(200) DEFAULT NULL AFTER created_by,
  ADD COLUMN IF NOT EXISTS archived_at DATETIME DEFAULT NULL AFTER updated_by,
  ADD INDEX IF NOT EXISTS idx_drip_sequences_tenant_active (tenant_id, archived_at, is_active);

ALTER TABLE drip_enrollments
  ADD COLUMN IF NOT EXISTS status ENUM('active','paused','completed','unenrolled','failed','unsubscribed')
    NOT NULL DEFAULT 'active' AFTER email,
  ADD COLUMN IF NOT EXISTS sequence_version INT NOT NULL DEFAULT 1 AFTER status,
  ADD COLUMN IF NOT EXISTS steps_snapshot JSON DEFAULT NULL AFTER sequence_version,
  ADD COLUMN IF NOT EXISTS enrolled_by VARCHAR(200) DEFAULT NULL AFTER steps_snapshot,
  ADD COLUMN IF NOT EXISTS paused_at DATETIME DEFAULT NULL AFTER next_send_at,
  ADD COLUMN IF NOT EXISTS pause_reason VARCHAR(500) DEFAULT NULL AFTER paused_at,
  ADD COLUMN IF NOT EXISTS unenrolled_at DATETIME DEFAULT NULL AFTER unsubscribed_at,
  ADD COLUMN IF NOT EXISTS exit_reason VARCHAR(100) DEFAULT NULL AFTER unenrolled_at,
  ADD COLUMN IF NOT EXISTS last_activity_at DATETIME DEFAULT NULL AFTER exit_reason,
  ADD INDEX IF NOT EXISTS idx_drip_enrollments_tenant_status_due
    (tenant_id, status, next_send_at),
  ADD INDEX IF NOT EXISTS idx_drip_enrollments_tenant_lead_status
    (tenant_id, lead_id, status),
  ADD INDEX IF NOT EXISTS idx_drip_enrollments_tenant_subscriber_status
    (tenant_id, subscriber_id, status);

UPDATE drip_enrollments
   SET status = CASE
     WHEN completed_at IS NOT NULL THEN 'completed'
     WHEN unsubscribed_at IS NOT NULL THEN 'unsubscribed'
     WHEN failed_at IS NOT NULL THEN 'failed'
     ELSE 'active'
   END;

UPDATE drip_enrollments de
JOIN drip_sequences ds
  ON ds.id=de.sequence_id AND ds.tenant_id=de.tenant_id
   SET de.sequence_version=ds.version,
       de.steps_snapshot=COALESCE(de.steps_snapshot, ds.steps);

CREATE TABLE IF NOT EXISTS crm_sequence_step_executions (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  enrollment_id VARCHAR(36) NOT NULL,
  sequence_id VARCHAR(36) NOT NULL,
  sequence_version INT NOT NULL,
  step_index INT NOT NULL,
  channel ENUM('email','whatsapp','task') NOT NULL DEFAULT 'email',
  status ENUM('queued','sent','delivered','failed','skipped') NOT NULL DEFAULT 'queued',
  due_at DATETIME DEFAULT NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  provider_message_id VARCHAR(191) DEFAULT NULL,
  last_error VARCHAR(1000) DEFAULT NULL,
  queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME DEFAULT NULL,
  delivered_at DATETIME DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_sequence_step (tenant_id, enrollment_id, step_index),
  UNIQUE KEY uq_crm_sequence_dedupe (dedupe_key),
  KEY idx_crm_sequence_execution_status (tenant_id, status, due_at),
  CONSTRAINT fk_crm_sequence_execution_enrollment
    FOREIGN KEY (enrollment_id) REFERENCES drip_enrollments(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
