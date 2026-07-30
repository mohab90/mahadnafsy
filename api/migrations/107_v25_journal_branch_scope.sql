-- Branch accountants need the same ledger-backed truth as central finance.
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS branch VARCHAR(30) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NULL AFTER branch,
  ADD INDEX IF NOT EXISTS idx_journal_tenant_branch_date (tenant_id, branch_id, entry_date);

UPDATE journal_entries je
JOIN payments p
  ON je.tenant_id=p.tenant_id AND je.ref_type='payment' AND je.ref_id=p.id
SET je.branch=COALESCE(je.branch,p.branch),
    je.branch_id=COALESCE(je.branch_id,p.branch_id)
WHERE je.branch_id IS NULL;

UPDATE journal_entries je
JOIN payments p
  ON je.tenant_id=p.tenant_id AND je.ref_type='refund' AND je.ref_id=p.id
SET je.branch=COALESCE(je.branch,p.branch),
    je.branch_id=COALESCE(je.branch_id,p.branch_id)
WHERE je.branch_id IS NULL;

UPDATE journal_entries je
JOIN expenses e
  ON je.tenant_id=e.tenant_id
 AND je.ref_type IN ('expense','expense_reversal')
 AND je.ref_id=e.id
SET je.branch_id=COALESCE(je.branch_id,e.branch_id)
WHERE je.branch_id IS NULL;
