-- 033_tenant_default_alignment.sql
-- Migration 011 created tenant_id columns with DEFAULT 'mahad'. Migration 028
-- tried to switch the canonical default to 'tenant-default' (matching prod,
-- lib/tenantScope.js, and middleware/tenantContext.js) but used
-- `ADD COLUMN IF NOT EXISTS` — a no-op once 011 had already created the column,
-- so the wrong default silently survived on any fresh install. Every read path
-- filters by req.tenantId (= 'tenant-default'), so a row inserted without an
-- explicit tenant_id (e.g. any INSERT that doesn't set it) got 'mahad' and
-- became invisible everywhere — confirmed live 2026-07-10 (a newly-created
-- lead vanished from its own list). Fix the DEFAULT on every table 011 touched
-- and backfill any row still carrying the stale value.
ALTER TABLE IF EXISTS leads                MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE IF EXISTS subscribers          MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE IF EXISTS payments             MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE IF EXISTS orders               MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE IF EXISTS expenses             MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE IF EXISTS staff                MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE IF EXISTS courses              MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE IF EXISTS bundles              MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE IF EXISTS consultations        MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE IF EXISTS enrollments          MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE IF EXISTS certificate_requests MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE IF EXISTS daqqi_rounds         MODIFY COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default';

UPDATE leads                SET tenant_id='tenant-default' WHERE tenant_id='mahad';
UPDATE subscribers          SET tenant_id='tenant-default' WHERE tenant_id='mahad';
UPDATE payments             SET tenant_id='tenant-default' WHERE tenant_id='mahad';
UPDATE orders               SET tenant_id='tenant-default' WHERE tenant_id='mahad';
UPDATE expenses             SET tenant_id='tenant-default' WHERE tenant_id='mahad';
UPDATE staff                SET tenant_id='tenant-default' WHERE tenant_id='mahad';
UPDATE courses              SET tenant_id='tenant-default' WHERE tenant_id='mahad';
UPDATE bundles              SET tenant_id='tenant-default' WHERE tenant_id='mahad';
UPDATE consultations        SET tenant_id='tenant-default' WHERE tenant_id='mahad';
UPDATE enrollments          SET tenant_id='tenant-default' WHERE tenant_id='mahad';
UPDATE certificate_requests SET tenant_id='tenant-default' WHERE tenant_id='mahad';
UPDATE daqqi_rounds         SET tenant_id='tenant-default' WHERE tenant_id='mahad';
