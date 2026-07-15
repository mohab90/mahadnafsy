ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other' AFTER tenant_id;
ALTER TABLE orders
  ADD INDEX IF NOT EXISTS idx_orders_tenant_branch (tenant_id, branch_id);

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other' AFTER tenant_id;
ALTER TABLE consultations
  ADD INDEX IF NOT EXISTS idx_consultations_tenant_branch (tenant_id, branch_id);

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other' AFTER tenant_id;
ALTER TABLE payroll_runs
  ADD INDEX IF NOT EXISTS idx_payroll_runs_tenant_branch (tenant_id, branch_id);

ALTER TABLE payroll_items
  ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other' AFTER tenant_id;
ALTER TABLE payroll_items
  ADD INDEX IF NOT EXISTS idx_payroll_items_tenant_branch (tenant_id, branch_id);

UPDATE subscribers
SET branch_id = CASE branch
  WHEN 'ONLINE_EGYPT' THEN 'branch-online-egypt'
  WHEN 'ONLINE_SAUDI' THEN 'branch-online-saudi'
  WHEN 'ONLINE_ABROAD' THEN 'branch-online-abroad'
  WHEN 'DAQQI' THEN 'branch-daqqi'
  WHEN 'TAGAMOA' THEN 'branch-tagamoa'
  WHEN 'OTHER' THEN 'branch-other'
  ELSE 'branch-other'
END
WHERE branch_id IS NULL OR branch_id = '' OR branch_id = 'branch-other';

UPDATE leads
SET branch_id = CASE branch
  WHEN 'ONLINE_EGYPT' THEN 'branch-online-egypt'
  WHEN 'ONLINE_SAUDI' THEN 'branch-online-saudi'
  WHEN 'ONLINE_ABROAD' THEN 'branch-online-abroad'
  WHEN 'DAQQI' THEN 'branch-daqqi'
  WHEN 'TAGAMOA' THEN 'branch-tagamoa'
  WHEN 'OTHER' THEN 'branch-other'
  ELSE 'branch-other'
END
WHERE branch_id IS NULL OR branch_id = '' OR branch_id = 'branch-other';

UPDATE payments p
LEFT JOIN subscribers s ON BINARY s.id = BINARY p.subscriber_id
SET p.branch_id = COALESCE(NULLIF(s.branch_id, ''), CASE p.branch
  WHEN 'ONLINE_EGYPT' THEN 'branch-online-egypt'
  WHEN 'ONLINE_SAUDI' THEN 'branch-online-saudi'
  WHEN 'ONLINE_ABROAD' THEN 'branch-online-abroad'
  WHEN 'DAQQI' THEN 'branch-daqqi'
  WHEN 'TAGAMOA' THEN 'branch-tagamoa'
  WHEN 'OTHER' THEN 'branch-other'
  ELSE 'branch-other'
END),
    p.branch = COALESCE(p.branch, s.branch)
WHERE p.branch_id IS NULL OR p.branch_id = '' OR p.branch_id = 'branch-other';

UPDATE enrollments e
LEFT JOIN subscribers s ON BINARY s.id = BINARY e.subscriber_id
SET e.branch_id = COALESCE(NULLIF(s.branch_id, ''), 'branch-other')
WHERE e.branch_id IS NULL OR e.branch_id = '' OR e.branch_id = 'branch-other';

UPDATE refund_requests rr
LEFT JOIN subscribers s ON BINARY s.id = BINARY rr.subscriber_id
LEFT JOIN payments p ON BINARY p.id = BINARY rr.payment_id
SET rr.branch_id = COALESCE(NULLIF(s.branch_id, ''), NULLIF(p.branch_id, ''), 'branch-other')
WHERE rr.branch_id IS NULL OR rr.branch_id = '' OR rr.branch_id = 'branch-other';

UPDATE orders o
LEFT JOIN subscribers s ON BINARY s.id = BINARY o.subscriber_id
SET o.branch_id = COALESCE(NULLIF(s.branch_id, ''), 'branch-other')
WHERE o.branch_id IS NULL OR o.branch_id = '' OR o.branch_id = 'branch-other';

UPDATE consultations c
LEFT JOIN subscribers s ON BINARY s.id = BINARY c.subscriber_id
SET c.branch_id = COALESCE(NULLIF(s.branch_id, ''), 'branch-other')
WHERE c.branch_id IS NULL OR c.branch_id = '' OR c.branch_id = 'branch-other';

UPDATE payroll_items pi
LEFT JOIN payroll_runs pr ON BINARY pr.id = BINARY pi.payroll_run_id
SET pi.branch_id = COALESCE(NULLIF(pr.branch_id, ''), 'branch-other')
WHERE pi.branch_id IS NULL OR pi.branch_id = '' OR pi.branch_id = 'branch-other';
