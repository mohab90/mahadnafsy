-- Nine indexes that another index on the same table already serves: each one's
-- columns are the leading columns of another (or, for transaction_id, the
-- same column under a UNIQUE key). A query that could use one uses the other
-- the same way, and every insert and update paid to maintain both. On the
-- leads table alone indexes are seven times the size of the data.
--
--   leads          idx_leads_status (status)          ⊂ idx_status_created (status, created_at)
--   leads          idx_leads_tenant (tenant_id)       ⊂ every index that leads with tenant_id
--   payments       idx_payments_staff (staff_id)      ⊂ idx_pay_staff_date
--   payments       idx_payments_tenant (tenant_id)    ⊂ the tenant-led indexes
--   payments       idx_payments_tenant_status_date    ⊂ idx_payments_tenant_amount_egp
--   payments       idx_payments_txn_id (prefix 191)   = UNIQUE idx_payments_txn (transaction_id)
--   subscribers    idx_subscribers_tenant             ⊂ the tenant-led indexes
--   subscribers    idx_subscribers_tenant_created     ⊂ idx_subscribers_tenant_created_id
--   enrollments    idx_enrollments_tenant             ⊂ the tenant-led indexes
--
-- None is named in a query hint, and none is the only index a foreign key has
-- (those were left alone). Which of the remaining ones are never read is a
-- question for production's own numbers: tools/perf-report.cjs lists them.
--
-- Rollback: re-create each, e.g.
--   ALTER TABLE leads ADD KEY idx_leads_status (status), ADD KEY idx_leads_tenant (tenant_id);

ALTER TABLE leads
  DROP INDEX IF EXISTS idx_leads_status,
  DROP INDEX IF EXISTS idx_leads_tenant;

ALTER TABLE payments
  DROP INDEX IF EXISTS idx_payments_staff,
  DROP INDEX IF EXISTS idx_payments_tenant,
  DROP INDEX IF EXISTS idx_payments_tenant_status_date,
  DROP INDEX IF EXISTS idx_payments_txn_id;

ALTER TABLE subscribers
  DROP INDEX IF EXISTS idx_subscribers_tenant,
  DROP INDEX IF EXISTS idx_subscribers_tenant_created;

ALTER TABLE enrollments
  DROP INDEX IF EXISTS idx_enrollments_tenant;
