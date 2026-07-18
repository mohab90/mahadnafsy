-- Tenant ownership for LMS/public-domain tables that previously relied on
-- indirect parent joins or global defaults.
ALTER TABLE course_ratings      ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_course_ratings_tenant (tenant_id, course_id);
ALTER TABLE course_completions  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_course_completions_tenant (tenant_id, subscriber_id);
ALTER TABLE lecture_completions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_lecture_completions_tenant (tenant_id, subscriber_id);
ALTER TABLE quiz_attempts       ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_quiz_attempts_tenant (tenant_id, subscriber_id);
ALTER TABLE referral_codes      ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_referral_codes_tenant (tenant_id, subscriber_id);
ALTER TABLE therapists          ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_therapists_tenant (tenant_id, is_active);
ALTER TABLE testimonials        ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_testimonials_tenant (tenant_id, is_active);
ALTER TABLE job_postings        ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_job_postings_tenant (tenant_id, status);
ALTER TABLE course_quizzes      ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_course_quizzes_tenant (tenant_id, course_id);
ALTER TABLE live_streams        ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default', ADD INDEX IF NOT EXISTS idx_live_streams_tenant (tenant_id, scheduled_at);

UPDATE course_ratings cr JOIN courses c ON c.id=cr.course_id SET cr.tenant_id=c.tenant_id;
UPDATE course_completions cc JOIN subscribers s ON s.id=cc.subscriber_id SET cc.tenant_id=s.tenant_id;
UPDATE lecture_completions lc JOIN subscribers s ON s.id=lc.subscriber_id SET lc.tenant_id=s.tenant_id;
UPDATE quiz_attempts qa JOIN subscribers s ON s.id=qa.subscriber_id SET qa.tenant_id=s.tenant_id;
UPDATE referral_codes rc JOIN subscribers s ON s.id=rc.subscriber_id SET rc.tenant_id=s.tenant_id;
