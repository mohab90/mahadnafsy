-- 12 Nov 2026, the owner: «في أخطاء بتظهر عند عملاء في الفلوس، خصوصاً في الدفعات الموزعة على أكتر من تحويل» (a booking of 4,100 whose note reads «التحويل ب 11600»).
-- A payment may now be confirmed by SEVERAL transfers (their amounts add up to it, lib/incomingTransfers.js linkTransfer), so the unique key that allowed only one
-- transfer per payment (migration 224) becomes a plain index. A transfer still confirms one payment only (its payment_id is one value) and an operation number is
-- still recorded once per box (uq_incoming_transfer_ref). payments.linked_transfer_id keeps pointing at the first transfer tied, for the screens that read one.
ALTER TABLE incoming_transfers
  ADD INDEX IF NOT EXISTS idx_incoming_transfers_payment (tenant_id, payment_id),
  DROP INDEX IF EXISTS uq_incoming_transfer_payment;
