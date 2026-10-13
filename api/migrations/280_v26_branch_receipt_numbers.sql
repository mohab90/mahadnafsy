-- Receipt numbers in sequence, per physical branch.
--
-- «محتاجين نخلي ارقام العمليات اللي هيا ارقام الايصالات تكون مرتبة بتسلسل ولو وقع رقم يظهر
-- للمديرين ان في مشكلة في ايصال رقم كذا مش موجود» (13 Oct 2026). payment_no (migration 239)
-- is one running number across EVERY payment of every branch, online included, so a Dokki
-- receipt was 40,112 and the next was 40,119 — nothing a desk could check. The branch's own
-- receipt number runs 1, 2, 3… for Dokki and again for Tagamoa, given to a payment in the
-- same transaction that records it (lib/receiptNumbers.js), so a payment that did not
-- happen leaves no number behind. A number with no row, or a row soft-deleted, is a gap the
-- managers are shown.
--
-- Existing payments of the physical branches are numbered in the order they were recorded
-- (the oldest is 1); the counter then continues from the largest.
--
-- Rollback:
--   ALTER TABLE payments DROP INDEX uq_payments_branch_receipt, DROP COLUMN receipt_no;
--   DROP TABLE receipt_counters;

CREATE TABLE IF NOT EXISTS receipt_counters (
  tenant_id VARCHAR(64) NOT NULL,
  branch VARCHAR(32) NOT NULL,
  last_no INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, branch)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS receipt_no INT NULL DEFAULT NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_payments_branch_receipt (tenant_id, branch, receipt_no);

UPDATE payments p
  JOIN (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id, branch ORDER BY created_at, `date`, id) AS rn
      FROM payments WHERE branch IN ('DAQQI', 'TAGAMOA') AND receipt_no IS NULL
  ) ordered ON ordered.id = p.id
   SET p.receipt_no = ordered.rn
 WHERE p.receipt_no IS NULL;

INSERT INTO receipt_counters (tenant_id, branch, last_no)
  SELECT tenant_id, branch, MAX(receipt_no) FROM payments
   WHERE branch IN ('DAQQI', 'TAGAMOA') AND receipt_no IS NOT NULL GROUP BY tenant_id, branch
  ON DUPLICATE KEY UPDATE last_no = GREATEST(last_no, VALUES(last_no));
