-- «تأكيد رد المبلغ» (POST /api/admin/finance/refunds/:id/mark-refunded) sets a
-- refund request to REFUNDED once the money has actually left the account. The
-- column has never accepted that value: 198 added refunded_at for it and 228
-- widened the enum for HANDLING only, so under STRICT_TRANS_TABLES every
-- confirmation failed with «Data truncated for column 'status'» and the desk
-- saw a 500. Reproduced on MariaDB 10.11 with the production schema.
--
-- Appending a member at the end of an ENUM is a metadata-only change: no row is
-- rewritten and every existing value keeps its index.
--
-- Rollback: only once no row holds REFUNDED (UPDATE … SET status='APPROVED'
-- WHERE status='REFUNDED' first, refunded_at keeps the date), then
--   ALTER TABLE refund_requests MODIFY COLUMN status
--     enum('PENDING','APPROVED','REJECTED','HANDLING') DEFAULT 'PENDING';
ALTER TABLE refund_requests
  MODIFY COLUMN status enum('PENDING','APPROVED','REJECTED','HANDLING','REFUNDED') DEFAULT 'PENDING';
