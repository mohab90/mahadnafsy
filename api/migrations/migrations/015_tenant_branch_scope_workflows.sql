-- Tenant/branch scope for cross-department workflows.
-- Non-destructive: adds normalized scope to orders, enrollments, consultations, finance review, and HR/accounting records.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';

ALTER TABLE consultations ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';

ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';

ALTER TABLE payment_proofs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE payment_proofs ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';

ALTER TABLE crm_commissions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE crm_commissions ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';

ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';

ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36) NOT NULL DEFAULT 'tenant-default';
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS branch_id VARCHAR(36) NOT NULL DEFAULT 'branch-other';

UPDATE orders o
LEFT JOIN subscribers s ON s.id = o.subscriber_id
LEFT JOIN subscribers se ON LOWER(TRIM(se.email)) = LOWER(TRIM(o.customer_email))
LEFT JOIN leads l ON LOWER(TRIM(l.email)) = LOWER(TRIM(o.customer_email))
SET o.tenant_id = COALESCE(NULLIF(o.tenant_id, ''), s.tenant_id, se.tenant_id, l.tenant_id, 'tenant-default'),
    o.branch_id = COALESCE(NULLIF(s.branch_id, ''), NULLIF(se.branch_id, ''), NULLIF(l.branch_id, ''), o.branch_id, 'branch-other')
WHERE o.tenant_id IS NULL OR o.tenant_id = '' OR o.branch_id IS NULL OR o.branch_id = '' OR o.branch_id = 'branch-other';

UPDATE enrollments e
JOIN subscribers s ON s.id = e.subscriber_id
SET e.tenant_id = COALESCE(NULLIF(e.tenant_id, ''), s.tenant_id, 'tenant-default'),
    e.branch_id = COALESCE(NULLIF(s.branch_id, ''), e.branch_id, 'branch-other')
WHERE e.tenant_id IS NULL OR e.tenant_id = '' OR e.branch_id IS NULL OR e.branch_id = '' OR e.branch_id = 'branch-other';

UPDATE consultations c
LEFT JOIN subscribers s ON s.id = c.subscriber_id
LEFT JOIN leads l ON (LOWER(TRIM(l.email)) = LOWER(TRIM(c.client_email)) OR l.phone = c.client_phone)
SET c.tenant_id = COALESCE(NULLIF(c.tenant_id, ''), s.tenant_id, l.tenant_id, 'tenant-default'),
    c.branch_id = COALESCE(NULLIF(s.branch_id, ''), NULLIF(l.branch_id, ''), c.branch_id, 'branch-other')
WHERE c.tenant_id IS NULL OR c.tenant_id = '' OR c.branch_id IS NULL OR c.branch_id = '' OR c.branch_id = 'branch-other';

UPDATE refund_requests rr
LEFT JOIN subscribers s ON s.id = rr.subscriber_id
LEFT JOIN payments p ON p.id = rr.payment_id
SET rr.tenant_id = COALESCE(NULLIF(rr.tenant_id, ''), p.tenant_id, s.tenant_id, 'tenant-default'),
    rr.branch_id = COALESCE(NULLIF(p.branch_id, ''), NULLIF(s.branch_id, ''), rr.branch_id, 'branch-other')
WHERE rr.tenant_id IS NULL OR rr.tenant_id = '' OR rr.branch_id IS NULL OR rr.branch_id = '' OR rr.branch_id = 'branch-other';

UPDATE payment_proofs pp
LEFT JOIN subscribers s ON s.id = pp.subscriber_id
SET pp.tenant_id = COALESCE(NULLIF(pp.tenant_id, ''), s.tenant_id, 'tenant-default'),
    pp.branch_id = COALESCE(NULLIF(s.branch_id, ''), pp.branch_id, 'branch-other')
WHERE pp.tenant_id IS NULL OR pp.tenant_id = '' OR pp.branch_id IS NULL OR pp.branch_id = '' OR pp.branch_id = 'branch-other';

UPDATE crm_commissions cc
LEFT JOIN payments p ON BINARY p.id = BINARY cc.payment_id
LEFT JOIN subscribers s ON BINARY s.id = BINARY cc.client_id AND cc.client_type = 'SUBSCRIBER'
LEFT JOIN leads l ON BINARY l.id = BINARY cc.client_id AND cc.client_type = 'LEAD'
SET cc.tenant_id = COALESCE(NULLIF(cc.tenant_id, ''), p.tenant_id, s.tenant_id, l.tenant_id, 'tenant-default'),
    cc.branch_id = COALESCE(NULLIF(p.branch_id, ''), NULLIF(s.branch_id, ''), NULLIF(l.branch_id, ''), cc.branch_id, 'branch-other')
WHERE cc.tenant_id IS NULL OR cc.tenant_id = '' OR cc.branch_id IS NULL OR cc.branch_id = '' OR cc.branch_id = 'branch-other';

UPDATE payroll_items pi
JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
SET pi.tenant_id = COALESCE(NULLIF(pi.tenant_id, ''), pr.tenant_id, 'tenant-default'),
    pi.branch_id = COALESCE(NULLIF(pi.branch_id, ''), pr.branch_id, 'branch-other')
WHERE pi.tenant_id IS NULL OR pi.tenant_id = '' OR pi.branch_id IS NULL OR pi.branch_id = '';

ALTER TABLE orders ADD INDEX IF NOT EXISTS idx_orders_tenant_branch (tenant_id, branch_id);
ALTER TABLE enrollments ADD INDEX IF NOT EXISTS idx_enrollments_tenant_branch (tenant_id, branch_id);
ALTER TABLE consultations ADD INDEX IF NOT EXISTS idx_consultations_tenant_branch (tenant_id, branch_id);
ALTER TABLE refund_requests ADD INDEX IF NOT EXISTS idx_refunds_tenant_branch (tenant_id, branch_id);
ALTER TABLE payment_proofs ADD INDEX IF NOT EXISTS idx_proofs_tenant_branch (tenant_id, branch_id);
ALTER TABLE crm_commissions ADD INDEX IF NOT EXISTS idx_commissions_tenant_branch (tenant_id, branch_id);
ALTER TABLE payroll_runs ADD INDEX IF NOT EXISTS idx_payroll_runs_tenant_branch (tenant_id, branch_id);
ALTER TABLE payroll_items ADD INDEX IF NOT EXISTS idx_payroll_items_tenant_branch (tenant_id, branch_id);
