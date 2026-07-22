-- Tenant isolation for every community content surface and the legacy forum.
ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_community_posts_tenant_status_created (tenant_id, status, created_at);

ALTER TABLE community_library
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_community_library_tenant_created (tenant_id, created_at);

ALTER TABLE community_videos
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_community_videos_tenant_created (tenant_id, created_at);

ALTER TABLE community_events
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_community_events_tenant_created (tenant_id, created_at);

ALTER TABLE forum_posts
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_forum_posts_tenant_parent_created (tenant_id, parent_id, created_at),
  ADD INDEX IF NOT EXISTS idx_forum_posts_tenant_course_created (tenant_id, course_id, created_at);

ALTER TABLE forum_upvotes
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_forum_upvotes_tenant_post (tenant_id, post_id);
