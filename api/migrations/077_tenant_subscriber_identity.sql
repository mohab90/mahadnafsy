-- Subscriber identity is unique per tenant; global email/phone/code uniqueness
-- prevents legitimate SaaS tenants from serving the same person independently.
DROP INDEX IF EXISTS uq_subs_email ON subscribers;
DROP INDEX IF EXISTS uq_subs_phone ON subscribers;
DROP INDEX IF EXISTS uq_subs_code ON subscribers;

ALTER TABLE subscribers
  ADD UNIQUE INDEX IF NOT EXISTS uq_subs_tenant_email (tenant_id, email(191)),
  ADD UNIQUE INDEX IF NOT EXISTS uq_subs_tenant_phone (tenant_id, phone),
  ADD UNIQUE INDEX IF NOT EXISTS uq_subs_tenant_code (tenant_id, client_code);
