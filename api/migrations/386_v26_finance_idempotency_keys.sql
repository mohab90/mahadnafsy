-- 11 Nov 2026: a double click on «حفظ» made two expenses with two expense numbers. The form now sends one key per opened form (a UUID made in the browser) and the server keeps it:
-- a second request carrying the same key is answered with the first one's result and writes nothing. Two genuinely identical expenses typed separately carry two keys and both save.
-- The same protection for the other finance writes a repeated request would double: a box withdrawal or transfer, and a manual journal entry. NULL on every row written before this
-- and on every request that sends no key (an old client, an import): MariaDB lets a UNIQUE key hold any number of NULLs.
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64) NULL DEFAULT NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_expenses_idempotency (tenant_id, idempotency_key);
ALTER TABLE box_withdrawals
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64) NULL DEFAULT NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_box_withdrawals_idempotency (tenant_id, idempotency_key);
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64) NULL DEFAULT NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_journal_entries_idempotency (tenant_id, idempotency_key);
