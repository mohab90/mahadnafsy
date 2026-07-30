ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'active' AFTER access_type,
  ADD COLUMN IF NOT EXISTS entitlement_source VARCHAR(64) NULL AFTER status,
  ADD COLUMN IF NOT EXISTS granted_by VARCHAR(255) NULL AFTER entitlement_source,
  ADD COLUMN IF NOT EXISTS revoked_at DATETIME NULL AFTER granted_by,
  ADD COLUMN IF NOT EXISTS revoked_by VARCHAR(255) NULL AFTER revoked_at,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER revoked_by,
  ADD INDEX IF NOT EXISTS idx_enrollments_tenant_status (tenant_id,status,subscriber_id,course_id);

CREATE TABLE IF NOT EXISTS entitlement_events (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  enrollment_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  course_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  source VARCHAR(64) NULL,
  actor VARCHAR(255) NULL,
  meta_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_entitlement_events_subject (tenant_id,subscriber_id,course_id,created_at),
  INDEX idx_entitlement_events_enrollment (tenant_id,enrollment_id,created_at),
  CONSTRAINT fk_entitlement_event_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
