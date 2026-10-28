-- What lib/dataRetention.js needs to trim the tables that only ever grew (21 Oct 2026, disk at 88%).
--
-- activity_logs_archive was made before activity_logs gained actor_name, department and details, so
-- lib/archiveJob.js's «INSERT … SELECT *» failed on the column count every night it was switched on.
ALTER TABLE activity_logs_archive ADD COLUMN IF NOT EXISTS actor_name VARCHAR(255) NULL;
ALTER TABLE activity_logs_archive ADD COLUMN IF NOT EXISTS department VARCHAR(80) NULL;
ALTER TABLE activity_logs_archive ADD COLUMN IF NOT EXISTS details TEXT NULL;
-- A sent message keeps its row (its dedupe key is what stops a «once ever» message going twice and
-- the campaign funnel joins it) but not its body after 90 days; this marks the rows already emptied,
-- and the index finds the ones still to do without reading every old row each night.
ALTER TABLE message_outbox ADD COLUMN IF NOT EXISTS payload_pruned_at DATETIME NULL;
ALTER TABLE message_outbox ADD INDEX IF NOT EXISTS idx_outbox_prune (status, payload_pruned_at, created_at);
ALTER TABLE job_queue ADD INDEX IF NOT EXISTS idx_job_queue_prune (status, done_at);
ALTER TABLE connector_events ADD INDEX IF NOT EXISTS idx_connector_event_prune (status, received_at);
