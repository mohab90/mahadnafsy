-- Multi-tenancy foundation 2026-06-20 (Top10 #1 / Top20 #1).
-- Adds tenant_id to core business tables, defaulting to 'mahad' so existing
-- single-tenant data is untouched. Queries are scoped via api/lib/tenantDb.js.
-- Run once via tools/run-migrations.mjs (tracked in schema_migrations).
-- NOTE: plain ALTERs — the runner guarantees one-time application.

ALTER TABLE leads                ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_leads_tenant (tenant_id);
ALTER TABLE subscribers          ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_subscribers_tenant (tenant_id);
ALTER TABLE payments             ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_payments_tenant (tenant_id);
ALTER TABLE orders               ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_orders_tenant (tenant_id);
ALTER TABLE expenses             ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_expenses_tenant (tenant_id);
ALTER TABLE staff                ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_staff_tenant (tenant_id);
ALTER TABLE courses              ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_courses_tenant (tenant_id);
ALTER TABLE bundles              ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_bundles_tenant (tenant_id);
ALTER TABLE consultations        ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_consultations_tenant (tenant_id);
ALTER TABLE enrollments          ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_enrollments_tenant (tenant_id);
ALTER TABLE certificate_requests ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_cert_req_tenant (tenant_id);
ALTER TABLE daqqi_rounds         ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'mahad', ADD INDEX idx_daqqi_rounds_tenant (tenant_id);
