-- 098_orders_linked_transfer_unique.sql
-- Migration 022's own comment already stated the intent: "a single transfer
-- can't be reused to confirm multiple payments" — but nothing ever enforced
-- it. The app-level check added in routes/orders.js (confirm-payment) closes
-- the normal-path gap; this closes the concurrent-request race (two admins
-- linking the same transfer to two different orders at the same moment).
-- NULL is allowed to repeat under a UNIQUE index (standard InnoDB behavior),
-- so orders with no linked transfer are unaffected.
ALTER TABLE orders ADD UNIQUE KEY IF NOT EXISTS uniq_orders_linked_transfer (linked_transfer_id);
