-- PERF-09/PERF-10: composite indexes for hot analytics queries that were doing a
-- full table scan for lack of a matching index.
--
-- PERF-09: misc/analytics.js's active-subscriber count
--   (SELECT COUNT(*) FROM subscribers WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL)
--   only had tenant_id indexed alone (idx_subscribers_tenant) or paired with
--   created_at — never with the actual lifecycle fields.
ALTER TABLE IF EXISTS subscribers ADD INDEX IF NOT EXISTS idx_subscribers_tenant_active_deleted (tenant_id, is_active, deleted_at);

-- PERF-10: the same file's at-risk-subscriber query correlates a NOT EXISTS
-- subquery per subscriber row on payments (subscriber_id + status='paid' +
-- created_at range). payments only had subscriber_id indexed alone
-- (idx_payments_subscriber) or paired with (status, date) at the tenant level —
-- never keyed for this per-subscriber lookup shape.
ALTER TABLE IF EXISTS payments ADD INDEX IF NOT EXISTS idx_payments_subscriber_status_created (subscriber_id, status, created_at);
