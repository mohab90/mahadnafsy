-- Operational finance records must be partitionable by branch.
ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS branch VARCHAR(30) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NULL AFTER branch,
  ADD INDEX IF NOT EXISTS idx_payment_links_tenant_branch_created (tenant_id, branch_id, created_at);

UPDATE payment_links pl
LEFT JOIN subscribers s
  ON s.id=pl.subscriber_id AND s.tenant_id=pl.tenant_id
SET pl.branch=COALESCE(pl.branch,s.branch,'ONLINE_EGYPT'),
    pl.branch_id=COALESCE(pl.branch_id,s.branch_id,'branch-online-egypt')
WHERE pl.branch_id IS NULL OR pl.branch_id='';

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS branch VARCHAR(30) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-all' AFTER branch;

DROP INDEX IF EXISTS uq_budget_tenant ON budgets;

ALTER TABLE budgets
  ADD UNIQUE INDEX IF NOT EXISTS uq_budget_tenant_branch (tenant_id, branch_id, month, category),
  ADD INDEX IF NOT EXISTS idx_budgets_tenant_branch_month (tenant_id, branch_id, month);

UPDATE refund_requests rr
LEFT JOIN payments p
  ON p.id=rr.payment_id AND p.tenant_id=rr.tenant_id
LEFT JOIN subscribers s
  ON s.id=rr.subscriber_id AND s.tenant_id=rr.tenant_id
SET rr.branch_id=COALESCE(rr.branch_id,p.branch_id,s.branch_id)
WHERE rr.branch_id IS NULL OR rr.branch_id='';
