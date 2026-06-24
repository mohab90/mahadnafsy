-- ============================================================================
-- 022_orders_linked_transfer.sql
-- Reconciliation: link a customer payment (order) to the bank transfer it was
-- matched against, so the accountant's match is recorded + auditable and a single
-- transfer can't be reused to confirm multiple payments.
-- Metadata-only nullable column add (instant, no table rebuild).
-- Apply: node tools/apply-migrations-resilient.mjs --from 022
-- (orders.js also adds this at startup via ADD COLUMN IF NOT EXISTS as a backup.)
-- ============================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS linked_transfer_id VARCHAR(36) DEFAULT NULL;
