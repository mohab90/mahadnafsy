-- A transfer linked to a smaller payment keeps the rest for another one.
--
-- «لو العميل دافع مبلغ كبير والمبلغ دا متقسم علي اكتر من تحويل … لو المبلغ 2000
-- جنيه وعملت ربط ب1000 جنيه يتبقي اتوماتك 1000 ويبقي فيها علامة ان دا باقي مبلغ
-- كبير كان 2000 … عميل كان دافع 1850 ربطه بدفعة 3000 جنيه، مبلغ 3000 جنيه كله
-- اتربط» (10 Oct 2026). A transfer confirmed exactly one payment and all of its
-- money went with it. Now linking a 3,000 transfer to a 1,850 payment leaves the
-- linked row at 1,850 and a new free row of 1,150 beside it (lib/incomingTransfers.js),
-- each remembering the transfer they came from (parent_transfer_id) and what it
-- was (original_amount), so the ledger's total is still the 3,000 that arrived.
--
-- Rollback:
--   ALTER TABLE incoming_transfers DROP INDEX idx_incoming_transfers_parent,
--     DROP COLUMN original_amount, DROP COLUMN parent_transfer_id;
--   (remainder rows stay as ordinary transfers)

ALTER TABLE incoming_transfers
  ADD COLUMN IF NOT EXISTS parent_transfer_id VARCHAR(36) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS original_amount DECIMAL(12,2) NULL DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_incoming_transfers_parent (tenant_id, parent_transfer_id);
