-- Reliability + governance tables 2026-06-20 (Top20 #6 #7 #8).

-- Generalised financial audit log (beyond payment status changes): expenses,
-- refunds, payroll, period reopen — anything that moves money.
CREATE TABLE IF NOT EXISTS financial_audit_log (
  id           VARCHAR(64)  NOT NULL PRIMARY KEY,
  tenant_id    VARCHAR(64)  NOT NULL DEFAULT 'mahad',
  entity_type  VARCHAR(40)  NOT NULL,         -- payment | expense | refund | payroll | period
  entity_id    VARCHAR(64)  NULL,
  action       VARCHAR(40)  NOT NULL,         -- create | update | delete | approve | reopen | ...
  old_json     JSON         NULL,
  new_json     JSON         NULL,
  amount       DECIMAL(12,2) NULL,
  actor        VARCHAR(120) NOT NULL DEFAULT 'system',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_faudit_entity (tenant_id, entity_type, entity_id),
  INDEX idx_faudit_created (created_at)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Transactional outbox: emails/whatsapp are enqueued in the same DB txn as the
-- business write, then a worker drains them — durable + retryable delivery.
CREATE TABLE IF NOT EXISTS message_outbox (
  id           VARCHAR(64)  NOT NULL PRIMARY KEY,
  tenant_id    VARCHAR(64)  NOT NULL DEFAULT 'mahad',
  channel      ENUM('email','whatsapp') NOT NULL,
  recipient    VARCHAR(255) NOT NULL,
  subject      VARCHAR(500) NULL,
  payload_json JSON         NOT NULL,
  status       ENUM('pending','sent','failed','dead') NOT NULL DEFAULT 'pending',
  attempts     INT          NOT NULL DEFAULT 0,
  last_error   TEXT         NULL,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at      TIMESTAMP    NULL,
  INDEX idx_outbox_due (status, next_attempt_at)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Durable job queue: replaces fire-and-forget setInterval work with claimable,
-- retryable jobs that survive restarts and give visibility.
CREATE TABLE IF NOT EXISTS job_queue (
  id           VARCHAR(64)  NOT NULL PRIMARY KEY,
  tenant_id    VARCHAR(64)  NOT NULL DEFAULT 'mahad',
  job_type     VARCHAR(80)  NOT NULL,
  payload_json JSON         NULL,
  status       ENUM('pending','running','done','failed','dead') NOT NULL DEFAULT 'pending',
  attempts     INT          NOT NULL DEFAULT 0,
  max_attempts INT          NOT NULL DEFAULT 5,
  run_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at    TIMESTAMP    NULL,
  locked_by    VARCHAR(80)  NULL,
  last_error   TEXT         NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  done_at      TIMESTAMP    NULL,
  INDEX idx_job_claim (status, run_at)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
