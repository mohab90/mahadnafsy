-- Business-facing identifiers may repeat across tenants, but never inside one tenant.
DROP INDEX IF EXISTS idx_courses_slug ON courses;
ALTER TABLE courses
  ADD UNIQUE INDEX IF NOT EXISTS uq_courses_tenant_slug (tenant_id, slug);

DROP INDEX IF EXISTS idx_bundles_slug ON bundles;
ALTER TABLE bundles
  ADD UNIQUE INDEX IF NOT EXISTS uq_bundles_tenant_slug (tenant_id, slug);

DROP INDEX IF EXISTS idx_leads_client_code ON leads;
ALTER TABLE leads
  ADD UNIQUE INDEX IF NOT EXISTS uq_leads_tenant_client_code (tenant_id, client_code);

DROP INDEX IF EXISTS idx_subscribers_firebase_uid ON subscribers;
ALTER TABLE subscribers
  ADD UNIQUE INDEX IF NOT EXISTS uq_subscribers_tenant_firebase (tenant_id, firebase_uid);
