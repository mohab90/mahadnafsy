-- Two lookups the reports made with no index to find them by (18 Oct 2026).
--
-- Measured against a private copy at production scale (150,000 leads, 30,000 clients, 60,000 orders):
--   GET /api/admin/funnel/attribution      timed out at 45 s   — joins every lead to subscribers by lead_id;
--                                                                 subscribers had no index on lead_id, so each
--                                                                 lead scanned the clients table.
--   GET /api/admin/abandoned-checkouts      31 s               — for each pending order it looked for a paid one
--                                                                 for the same item and phone or email; the only
--                                                                 index that applied was (tenant, status, created_at),
--                                                                 so each pending order read every paid order.
-- The leads «converted without a subscriber» check on the reconciliation screen asks the first question too.
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subscribers_tenant_lead (tenant_id, lead_id);
ALTER TABLE orders ADD INDEX IF NOT EXISTS idx_orders_paid_lookup_phone (tenant_id, status, item_id, customer_phone);
ALTER TABLE orders ADD INDEX IF NOT EXISTS idx_orders_paid_lookup_email (tenant_id, status, item_id, customer_email(100));
