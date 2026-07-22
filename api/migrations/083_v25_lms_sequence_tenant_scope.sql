-- Tenant ownership for LMS scheduling and automation tables that predate SaaS isolation.
ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_live_sessions_tenant (tenant_id, course_id, starts_at);

ALTER TABLE course_waitlist
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_course_waitlist_tenant (tenant_id, course_id, status, position);

ALTER TABLE email_sequences
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_email_sequences_tenant (tenant_id, trigger_event, is_active);

ALTER TABLE email_sequence_steps
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_email_sequence_steps_tenant (tenant_id, sequence_id, step_order);

ALTER TABLE email_sequence_queue
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_email_sequence_queue_tenant (tenant_id, scheduled_at, sent_at, failed_at);

UPDATE live_sessions SET tenant_id='tenant-default' WHERE tenant_id IS NULL OR tenant_id IN ('', 'mahad');
UPDATE course_waitlist SET tenant_id='tenant-default' WHERE tenant_id IS NULL OR tenant_id IN ('', 'mahad');
UPDATE email_sequences SET tenant_id='tenant-default' WHERE tenant_id IS NULL OR tenant_id IN ('', 'mahad');
UPDATE email_sequence_steps SET tenant_id='tenant-default' WHERE tenant_id IS NULL OR tenant_id IN ('', 'mahad');
UPDATE email_sequence_queue SET tenant_id='tenant-default' WHERE tenant_id IS NULL OR tenant_id IN ('', 'mahad');
