-- Hardens live finance scope and adds production observability primitives.

UPDATE payments p
LEFT JOIN subscribers s ON CAST(s.id AS CHAR) = CAST(p.subscriber_id AS CHAR)
SET
  p.tenant_id = COALESCE(NULLIF(p.tenant_id, ''), NULLIF(s.tenant_id, ''), 'tenant-default'),
  p.branch = COALESCE(
    p.branch,
    s.branch,
    'ONLINE_EGYPT'
  ),
  p.branch_id = COALESCE(
    NULLIF(p.branch_id, ''),
    NULLIF(s.branch_id, ''),
    CASE COALESCE(p.branch, s.branch, 'ONLINE_EGYPT')
      WHEN 'DAQQI' THEN 'branch-daqqi'
      WHEN 'TAGAMOA' THEN 'branch-tagamoa'
      WHEN 'ONLINE_EGYPT' THEN 'branch-online-egypt'
      WHEN 'ONLINE_SAUDI' THEN 'branch-online-saudi'
      WHEN 'ONLINE_ABROAD' THEN 'branch-online-abroad'
      ELSE 'branch-other'
    END
  )
WHERE p.deleted_at IS NULL
  AND (
    p.tenant_id IS NULL OR p.tenant_id = ''
    OR p.branch IS NULL
    OR p.branch_id IS NULL OR p.branch_id = ''
  );

UPDATE enrollments e
LEFT JOIN subscribers s ON CAST(s.id AS CHAR) = CAST(e.subscriber_id AS CHAR)
SET
  e.tenant_id = COALESCE(NULLIF(e.tenant_id, ''), NULLIF(s.tenant_id, ''), 'tenant-default'),
  e.branch_id = COALESCE(NULLIF(e.branch_id, ''), NULLIF(s.branch_id, ''), 'branch-online-egypt')
WHERE e.tenant_id IS NULL OR e.tenant_id = '' OR e.branch_id IS NULL OR e.branch_id = '';

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  actor_id VARCHAR(100) DEFAULT NULL,
  actor_role VARCHAR(80) DEFAULT NULL,
  action VARCHAR(160) NOT NULL,
  entity_type VARCHAR(120) DEFAULT NULL,
  entity_id VARCHAR(120) DEFAULT NULL,
  severity ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
  metadata_json JSON DEFAULT NULL,
  ip_address VARCHAR(80) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_logs_tenant_created (tenant_id, created_at),
  KEY idx_audit_logs_entity (entity_type, entity_id),
  KEY idx_audit_logs_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS queue_jobs (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  queue_name VARCHAR(120) NOT NULL,
  job_name VARCHAR(160) NOT NULL,
  status ENUM('pending','processing','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  priority INT NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  payload_json JSON DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  run_after DATETIME DEFAULT NULL,
  locked_at DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_queue_jobs_pickup (queue_name, status, priority, run_after, created_at),
  KEY idx_queue_jobs_tenant_status (tenant_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
