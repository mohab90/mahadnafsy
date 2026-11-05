-- 5 Nov 2026. Three single-column indexes whose column is the FIRST of another index of the same table: every lookup they served is served by the longer one
-- (a composite index answers its leading column alone), and each costs a write on every insert and update of payments and orders.
--   idx_payments_subscriber (subscriber_id)  <- idx_payments_subscriber_status_created (subscriber_id, status, created_at)
--   idx_orders_status       (status)         <- idx_orders_status_created (status, created_at)
--   idx_orders_tenant       (tenant_id)      <- idx_orders_tenant_branch (tenant_id, branch_id)
-- Found by tools/redundant-indexes.cjs, which lists only exact leading-prefix and identical indexes. The leads table (40 indexes) has none of those: which of
-- its indexes nobody reads needs the server's own counters (tools/index-usage-report.cjs), so none of them is touched here.
ALTER TABLE payments DROP INDEX IF EXISTS idx_payments_subscriber;
ALTER TABLE orders DROP INDEX IF EXISTS idx_orders_status;
ALTER TABLE orders DROP INDEX IF EXISTS idx_orders_tenant;
