-- Internal recurring subscription billing must never mix tenants.
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id,
  ADD INDEX IF NOT EXISTS idx_subscription_plans_tenant_active (tenant_id, is_active);

ALTER TABLE subscriber_subscriptions
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id;

UPDATE subscriber_subscriptions ss
JOIN subscribers s ON s.id=ss.subscriber_id
SET ss.tenant_id=s.tenant_id
WHERE ss.tenant_id IS NULL OR ss.tenant_id<>s.tenant_id;

ALTER TABLE subscriber_subscriptions
  ADD INDEX IF NOT EXISTS idx_subscriber_subscriptions_tenant_due
    (tenant_id, status, auto_renew, next_billing_date),
  ADD INDEX IF NOT EXISTS idx_subscriber_subscriptions_tenant_subscriber
    (tenant_id, subscriber_id);
