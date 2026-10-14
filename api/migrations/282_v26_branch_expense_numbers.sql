-- Expense numbers in sequence, per physical branch — the money going out of the Dokki and
-- Tagamoa treasuries is numbered like the money coming in.
--
-- «ضيف رقم عملية للمصروفات» (14 Oct 2026), beside the branch receipt numbers of migration 280:
-- an expense of Dokki is «مصروف رقم 1، 2، 3 …», Tagamoa's runs on its own, given in the same
-- transaction that records the expense (lib/receiptNumbers.js nextExpenseNo), so one that fails
-- leaves no number behind. A number with no row, or whose expense was deleted, is a gap the
-- managers are shown (GET /api/admin/receipts/gaps). Online expenses are not numbered.
--
-- Existing expenses of the two branches are numbered in the order they were recorded (the
-- oldest is 1), deleted ones included, so a deleted one shows as the gap it left; the counter
-- (receipt_counters, key DAQQI_EXP / TAGAMOA_EXP) continues from the largest.
--
-- Rollback:
--   ALTER TABLE expenses DROP INDEX uq_expenses_branch_no, DROP COLUMN expense_no;
--   DELETE FROM receipt_counters WHERE branch IN ('DAQQI_EXP', 'TAGAMOA_EXP');

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS expense_no INT NULL DEFAULT NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_expenses_branch_no (tenant_id, branch_id, expense_no);

UPDATE expenses e
  JOIN (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id, branch_id ORDER BY created_at, `date`, id) AS rn
      FROM expenses WHERE branch_id IN ('branch-daqqi', 'branch-tagamoa') AND expense_no IS NULL
  ) ordered ON ordered.id = e.id
   SET e.expense_no = ordered.rn
 WHERE e.expense_no IS NULL;

INSERT INTO receipt_counters (tenant_id, branch, last_no)
  SELECT tenant_id, IF(branch_id = 'branch-daqqi', 'DAQQI_EXP', 'TAGAMOA_EXP'), MAX(expense_no) FROM expenses
   WHERE branch_id IN ('branch-daqqi', 'branch-tagamoa') AND expense_no IS NOT NULL GROUP BY tenant_id, branch_id
  ON DUPLICATE KEY UPDATE last_no = GREATEST(last_no, VALUES(last_no));
