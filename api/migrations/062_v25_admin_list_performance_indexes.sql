-- Speed up the hottest admin list reads without changing route behavior.
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_hidden_created_id (tenant_id, hidden, created_at, id);
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subscribers_tenant_created_id (tenant_id, created_at, id);
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subscribers_tenant_branch_created (tenant_id, branch_id, created_at);
ALTER TABLE daqqi_attendees ADD INDEX IF NOT EXISTS idx_daqqi_attendees_round (round_id);
ALTER TABLE daqqi_attendees ADD INDEX IF NOT EXISTS idx_daqqi_attendees_subscriber (subscriber_id);
ALTER TABLE daqqi_rounds ADD INDEX IF NOT EXISTS idx_daqqi_rounds_created (created_at, id);
