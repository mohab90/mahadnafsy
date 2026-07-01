-- 028_tenant_id_on_business_tables.sql  (SaaS phase 2 — ported scope set from 26)
-- Adds tenant_id to every business table, matching the exact set 26 scoped.
-- BACKWARD-COMPATIBLE + ADDITIVE:
--   • column is nullable with DEFAULT 'mahad';
--   • existing rows are backfilled to 'mahad' (the single institute);
--   • an index is added for future scoped queries.
-- Existing single-institute queries ignore the column, so nothing breaks. Route
-- scoping (WHERE tenant_id = ?) is wired incrementally in a later phase.
--
-- `ALTER TABLE IF EXISTS` + `ADD COLUMN IF NOT EXISTS` (MariaDB 11.8) make this
-- safe to run repeatedly and tolerant of tables that don't exist in this schema.

-- Helper pattern applied to each table:
--   ALTER TABLE IF EXISTS <t> ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
--   UPDATE <t> SET tenant_id='mahad' WHERE tenant_id IS NULL;
--   ALTER TABLE IF EXISTS <t> ADD INDEX IF NOT EXISTS idx_<t>_tenant (tenant_id);

ALTER TABLE IF EXISTS subscribers            ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS leads                  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS payments               ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS orders                 ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS enrollments            ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS expenses               ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS recurring_expenses     ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS consultations          ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS contact_messages       ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS join_us_applications   ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS payment_proofs         ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS refund_requests        ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS payroll_items          ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS payroll_runs           ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS crm_commissions        ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS email_campaigns        ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS sms_campaigns          ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS drip_campaigns         ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS nps_responses          ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';
ALTER TABLE IF EXISTS support_tickets        ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) DEFAULT 'mahad';

-- Backfill existing rows to the single default tenant.
UPDATE subscribers          SET tenant_id='mahad' WHERE tenant_id IS NULL;
UPDATE leads                SET tenant_id='mahad' WHERE tenant_id IS NULL;
UPDATE payments             SET tenant_id='mahad' WHERE tenant_id IS NULL;
UPDATE orders               SET tenant_id='mahad' WHERE tenant_id IS NULL;
UPDATE enrollments          SET tenant_id='mahad' WHERE tenant_id IS NULL;
UPDATE expenses             SET tenant_id='mahad' WHERE tenant_id IS NULL;

-- Indexes for the future scoped queries.
ALTER TABLE IF EXISTS subscribers      ADD INDEX IF NOT EXISTS idx_subscribers_tenant (tenant_id);
ALTER TABLE IF EXISTS leads            ADD INDEX IF NOT EXISTS idx_leads_tenant (tenant_id);
ALTER TABLE IF EXISTS payments         ADD INDEX IF NOT EXISTS idx_payments_tenant (tenant_id);
ALTER TABLE IF EXISTS orders           ADD INDEX IF NOT EXISTS idx_orders_tenant (tenant_id);
ALTER TABLE IF EXISTS enrollments      ADD INDEX IF NOT EXISTS idx_enrollments_tenant (tenant_id);
ALTER TABLE IF EXISTS expenses         ADD INDEX IF NOT EXISTS idx_expenses_tenant (tenant_id);
