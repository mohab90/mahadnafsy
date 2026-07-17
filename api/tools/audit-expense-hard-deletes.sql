-- ═══════════════════════════════════════════════════════════════════════════
-- Detect past HARD-deletes of expenses (before the soft-delete fix)
-- ═══════════════════════════════════════════════════════════════════════════
-- Context: DELETE /api/admin/expenses/:id used to run a real `DELETE FROM
-- expenses` (in routes/admin-operations.js) instead of a soft delete. Every
-- such delete was still logged by the global auditAdmin middleware to
-- activity_logs (entity='expenses', action='delete'). This query recovers the
-- list of expense IDs that were hard-deleted and cross-checks whether the row
-- still exists in the expenses table.
--
-- Run:  mysql -u USER -p DB_NAME < api/tools/audit-expense-hard-deletes.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) All logged expense deletions, newest first — who deleted what and when.
SELECT
    al.entity_id        AS expense_id,
    al.actor            AS deleted_by,
    al.created_at       AS deleted_at_log,
    (e.id IS NOT NULL)  AS still_in_table,
    e.deleted_at        AS soft_deleted_at,
    e.amount, e.currency, e.category, e.description, e.date AS expense_date
FROM activity_logs al
LEFT JOIN expenses e ON e.id = al.entity_id
WHERE al.entity = 'expenses'
  AND al.action = 'delete'
ORDER BY al.created_at DESC;

-- 2) Summary: how many logged expense deletions are GONE from the table
--    (i.e. genuine hard-deletes with no recoverable row) vs still present.
SELECT
    SUM(CASE WHEN e.id IS NULL THEN 1 ELSE 0 END)                          AS hard_deleted_gone,
    SUM(CASE WHEN e.id IS NOT NULL AND e.deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS soft_deleted_present,
    SUM(CASE WHEN e.id IS NOT NULL AND e.deleted_at IS NULL THEN 1 ELSE 0 END)     AS still_active,
    COUNT(*)                                                               AS total_logged_deletes
FROM activity_logs al
LEFT JOIN expenses e ON e.id = al.entity_id
WHERE al.entity = 'expenses'
  AND al.action = 'delete';

-- 3) Ledger cross-check: for the hard-deleted (gone) expense IDs, is there an
--    orphaned journal entry still posted with no surviving source expense?
--    (Only meaningful if expense journaling was ever active. journal_entries.ref_id
--    holds the expense id for ref_type IN ('expense','expense_reversal').)
SELECT
    je.ref_id           AS expense_id,
    je.ref_type, je.entry_date, je.description,
    je.total_debit, je.total_credit,
    (e.id IS NOT NULL)  AS source_expense_exists
FROM journal_entries je
LEFT JOIN expenses e ON e.id = je.ref_id
WHERE je.ref_type IN ('expense', 'expense_reversal')
  AND e.id IS NULL
ORDER BY je.entry_date DESC;
