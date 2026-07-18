-- Tenant/branch scope for core operational records.
-- Non-destructive: keeps legacy text branch while adding normalized tenant_id/branch_id.

INSERT INTO branches (id, tenant_id, branch_key, slug, label, branch_type, timezone, currency, modules_json, tabs_json, is_active)
VALUES
  ('branch-online-egypt', 'tenant-default', 'online_egypt', 'online-egypt', 'Online Egypt', 'online', 'Africa/Cairo', 'EGP', JSON_ARRAY('clients','leads','payments'), JSON_ARRAY('online_clients','leads','orders'), 1),
  ('branch-online-saudi', 'tenant-default', 'online_saudi', 'online-saudi', 'Online Saudi', 'online', 'Asia/Riyadh', 'SAR', JSON_ARRAY('clients','leads','payments'), JSON_ARRAY('online_clients','leads','orders'), 1),
  ('branch-online-abroad', 'tenant-default', 'online_abroad', 'online-abroad', 'Online Abroad', 'online', 'UTC', 'USD', JSON_ARRAY('clients','leads','payments'), JSON_ARRAY('online_clients','leads','orders'), 1),
  ('branch-daqqi', 'tenant-default', 'daqqi', 'daqqi', 'Daqqi Branch', 'physical', 'Africa/Cairo', 'EGP', JSON_ARRAY('clients','schedule','payments'), JSON_ARRAY('daqqi_schedule','daqqi_clients','orders'), 1),
  ('branch-tagamoa', 'tenant-default', 'tagamoa', 'tagamoa', 'Tagamoa Branch', 'physical', 'Africa/Cairo', 'EGP', JSON_ARRAY('clients','schedule','payments'), JSON_ARRAY('online_clients','leads','orders'), 1),
  ('branch-other', 'tenant-default', 'other', 'other', 'Other / Unclassified', 'other', 'Africa/Cairo', 'EGP', JSON_ARRAY('clients','leads','payments'), JSON_ARRAY('online_clients','leads','orders'), 1)
ON DUPLICATE KEY UPDATE
  label=VALUES(label),
  branch_type=VALUES(branch_type),
  timezone=VALUES(timezone),
  currency=VALUES(currency),
  modules_json=VALUES(modules_json),
  tabs_json=VALUES(tabs_json),
  is_active=VALUES(is_active);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';

ALTER TABLE leads ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';

UPDATE leads
SET tenant_id = COALESCE(NULLIF(tenant_id, ''), 'tenant-default'),
    branch_id = CASE branch
      WHEN 'ONLINE_EGYPT' THEN 'branch-online-egypt'
      WHEN 'ONLINE_SAUDI' THEN 'branch-online-saudi'
      WHEN 'ONLINE_ABROAD' THEN 'branch-online-abroad'
      WHEN 'DAQQI' THEN 'branch-daqqi'
      WHEN 'TAGAMOA' THEN 'branch-tagamoa'
      ELSE 'branch-other'
    END
WHERE tenant_id IS NULL OR tenant_id = '' OR branch_id IS NULL OR branch_id = '' OR branch_id = 'branch-other';

UPDATE subscribers
SET tenant_id = COALESCE(NULLIF(tenant_id, ''), 'tenant-default'),
    branch_id = CASE branch
      WHEN 'ONLINE_EGYPT' THEN 'branch-online-egypt'
      WHEN 'ONLINE_SAUDI' THEN 'branch-online-saudi'
      WHEN 'ONLINE_ABROAD' THEN 'branch-online-abroad'
      WHEN 'DAQQI' THEN 'branch-daqqi'
      WHEN 'TAGAMOA' THEN 'branch-tagamoa'
      ELSE 'branch-other'
    END
WHERE tenant_id IS NULL OR tenant_id = '' OR branch_id IS NULL OR branch_id = '' OR branch_id = 'branch-other';

UPDATE payments
SET tenant_id = COALESCE(NULLIF(tenant_id, ''), 'tenant-default'),
    branch_id = CASE branch
      WHEN 'ONLINE_EGYPT' THEN 'branch-online-egypt'
      WHEN 'ONLINE_SAUDI' THEN 'branch-online-saudi'
      WHEN 'ONLINE_ABROAD' THEN 'branch-online-abroad'
      WHEN 'DAQQI' THEN 'branch-daqqi'
      WHEN 'TAGAMOA' THEN 'branch-tagamoa'
      ELSE 'branch-other'
    END
WHERE tenant_id IS NULL OR tenant_id = '' OR branch_id IS NULL OR branch_id = '' OR branch_id = 'branch-other';

ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_branch (tenant_id, branch_id);
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subscribers_tenant_branch (tenant_id, branch_id);
ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_tenant_branch (tenant_id, branch_id);

