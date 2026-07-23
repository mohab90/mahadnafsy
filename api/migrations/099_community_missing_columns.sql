-- 099_community_missing_columns.sql
-- Three community admin forms collect fields the schema never had a column
-- for, so they were silently dropped on every save (MKT-12/13/14):
--   community_library.file_size  — shown in DashboardCommunityAdminPanel.tsx's
--     library cards, never persisted.
--   community_events.speaker / .event_type / .platform — shown in the events
--     form, never persisted.
--   community_videos.views_label — shown in the videos form, never persisted.
ALTER TABLE community_library ADD COLUMN IF NOT EXISTS file_size VARCHAR(50) DEFAULT NULL;
ALTER TABLE community_events ADD COLUMN IF NOT EXISTS speaker VARCHAR(200) DEFAULT NULL;
ALTER TABLE community_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(100) DEFAULT NULL;
ALTER TABLE community_events ADD COLUMN IF NOT EXISTS platform VARCHAR(100) DEFAULT NULL;
ALTER TABLE community_videos ADD COLUMN IF NOT EXISTS views_label VARCHAR(50) DEFAULT NULL;
