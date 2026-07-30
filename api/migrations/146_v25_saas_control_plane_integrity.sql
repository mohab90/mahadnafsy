-- Collapse legacy duplicates before enforcing one effective row per scope.
DELETE older
FROM feature_flags older
JOIN feature_flags newer
  ON older.flag_key=newer.flag_key
 AND COALESCE(older.tenant_id, '__global__')=COALESCE(newer.tenant_id, '__global__')
 AND (
      older.updated_at < newer.updated_at
      OR (older.updated_at = newer.updated_at AND older.id < newer.id)
 );

ALTER TABLE feature_flags
  ADD COLUMN IF NOT EXISTS scope_tenant_key VARCHAR(36)
    NOT NULL DEFAULT '__global__';

UPDATE feature_flags
SET scope_tenant_key=COALESCE(tenant_id, '__global__');

ALTER TABLE feature_flags
  ADD CONSTRAINT IF NOT EXISTS chk_feature_flags_scope
    CHECK (
      (tenant_id IS NULL AND scope_tenant_key='__global__')
      OR (tenant_id IS NOT NULL AND scope_tenant_key=tenant_id)
    ),
  ADD UNIQUE INDEX IF NOT EXISTS uq_feature_flags_scope_key
    (scope_tenant_key, flag_key);

ALTER TABLE tenant_subscriptions
  ADD COLUMN IF NOT EXISTS active_tenant_id VARCHAR(36) DEFAULT NULL;

UPDATE tenant_subscriptions older
JOIN tenant_subscriptions newer
  ON older.tenant_id=newer.tenant_id
 AND older.status IN ('active','trialing','past_due')
 AND newer.status IN ('active','trialing','past_due')
 AND (
      older.created_at < newer.created_at
      OR (older.created_at = newer.created_at AND older.id < newer.id)
 )
SET older.status='cancelled',
    older.active_tenant_id=NULL,
    older.ends_at=COALESCE(older.ends_at, NOW());

UPDATE tenant_subscriptions
SET active_tenant_id=CASE
  WHEN status IN ('active','trialing','past_due') THEN tenant_id
  ELSE NULL
END;

ALTER TABLE tenant_subscriptions
  ADD CONSTRAINT IF NOT EXISTS chk_tenant_subscription_active_scope
    CHECK (
      (status IN ('active','trialing','past_due') AND active_tenant_id=tenant_id)
      OR (status NOT IN ('active','trialing','past_due') AND active_tenant_id IS NULL)
    ),
  ADD UNIQUE INDEX IF NOT EXISTS uq_tenant_subscription_active
    (active_tenant_id);
