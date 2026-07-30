-- Fast tenant-scoped pipeline inspection over the immutable lead timeline.
ALTER TABLE lead_timeline
  ADD INDEX IF NOT EXISTS idx_lead_timeline_tenant_event_at
    (tenant_id, event_type, at, lead_id);
