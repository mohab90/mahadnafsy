ALTER TABLE course_completions
  ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'active' AFTER completed_at,
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1 AFTER status,
  ADD COLUMN IF NOT EXISTS revoked_at DATETIME NULL AFTER version,
  ADD COLUMN IF NOT EXISTS revoked_by VARCHAR(255) NULL AFTER revoked_at,
  ADD COLUMN IF NOT EXISTS revoke_reason VARCHAR(500) NULL AFTER revoked_by,
  ADD COLUMN IF NOT EXISTS reissued_at DATETIME NULL AFTER revoke_reason,
  ADD COLUMN IF NOT EXISTS reissued_by VARCHAR(255) NULL AFTER reissued_at,
  ADD INDEX IF NOT EXISTS idx_course_completions_tenant_status (tenant_id,status,completed_at);

CREATE TABLE IF NOT EXISTS certificate_lifecycle_events (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  completion_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(24) NOT NULL,
  old_code VARCHAR(50) NULL,
  new_code VARCHAR(50) NULL,
  actor VARCHAR(255) NULL,
  reason VARCHAR(500) NULL,
  meta_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_certificate_events_completion (tenant_id,completion_id,created_at),
  INDEX idx_certificate_events_code (tenant_id,new_code),
  CONSTRAINT fk_certificate_event_completion FOREIGN KEY (completion_id) REFERENCES course_completions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO certificate_lifecycle_events
  (id,tenant_id,completion_id,event_type,new_code,actor,reason,created_at)
SELECT UUID(),cc.tenant_id,cc.id,'issued',cc.certificate_code,'migration','Existing certificate lifecycle backfill',cc.completed_at
FROM course_completions cc
WHERE NOT EXISTS (
  SELECT 1 FROM certificate_lifecycle_events e
  WHERE e.tenant_id=cc.tenant_id AND e.completion_id=cc.id AND e.event_type='issued'
);
