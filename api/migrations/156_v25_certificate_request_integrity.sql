ALTER TABLE certificate_requests
  ADD COLUMN IF NOT EXISTS active_request_marker TINYINT
    GENERATED ALWAYS AS (
      CASE WHEN status <> 'DELIVERED' THEN 1 ELSE NULL END
    ) STORED,
  ADD UNIQUE INDEX IF NOT EXISTS uq_certificate_active_request
    (tenant_id, subscriber_id, course_id, type, active_request_marker),
  ADD INDEX IF NOT EXISTS idx_certificate_tenant_status_requested
    (tenant_id, status, requested_at);
