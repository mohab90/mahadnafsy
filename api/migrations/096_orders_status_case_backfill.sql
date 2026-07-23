-- 096_orders_status_case_backfill.sql
-- Three separate order-creation entry points (public-orders.js /api/orders/reserve,
-- lead-capture-crm.js manual-transfer checkout intent) wrote status='PENDING'
-- (uppercase), and the two real payment-confirmation paths (public-orders.js
-- Paymob finalisation, payment-proofs.js proof approval) wrote status='PAID'
-- (uppercase) — while orders.js's own admin-created orders default to
-- lowercase 'pending', and every frontend comparison (OrdersTab.tsx etc.) and
-- several backend reads compare against lowercase. Any order actually paid
-- through Paymob or an approved manual transfer — i.e. essentially all real
-- online revenue — was stored as status='PAID' and therefore invisible to
-- every lowercase-comparing reader: stuck showing as unpaid/pending forever.
-- Fixes are in api/routes/{public-orders,payment-proofs,lead-capture-crm,
-- orders,core/payops}.js (all writes/reads now lowercase). This backfills
-- rows already affected before that fix shipped.
UPDATE orders SET status = 'pending' WHERE status = 'PENDING';
UPDATE orders SET status = 'paid'    WHERE status = 'PAID';
UPDATE orders SET status = 'failed'  WHERE status = 'FAILED';
UPDATE orders SET status = 'cancelled' WHERE status = 'CANCELLED';
UPDATE orders SET status = 'refunded' WHERE status = 'REFUNDED';
