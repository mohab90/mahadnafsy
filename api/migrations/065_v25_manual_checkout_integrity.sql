-- Makes the manual-transfer checkout the authoritative payment path while the
-- online gateway is paused. Every proof is tied to a server-priced order and
-- carries the same tenant/branch/product identity through finance.

ALTER TABLE orders
  MODIFY COLUMN type ENUM('COURSE','BUNDLE','CONSULTATION','CERTIFICATE','OTHER') NOT NULL;

ALTER TABLE payments
  MODIFY COLUMN payment_type ENUM('COURSE','BUNDLE','CERTIFICATE','CONSULTATION','BOOK','CARNEH','OTHER') DEFAULT NULL;

-- Express consultations are assigned to a therapist after payment review.
ALTER TABLE consultations
  MODIFY COLUMN therapist_id VARCHAR(36) NULL;

ALTER TABLE payment_proofs
  ADD COLUMN IF NOT EXISTS order_id VARCHAR(36) DEFAULT NULL AFTER id,
  ADD COLUMN IF NOT EXISTS bundle_id VARCHAR(100) DEFAULT NULL AFTER course_id,
  ADD COLUMN IF NOT EXISTS item_type ENUM('course','bundle','consultation','certificate','other') NOT NULL DEFAULT 'course' AFTER bundle_id,
  ADD INDEX IF NOT EXISTS idx_pp_order (order_id),
  ADD INDEX IF NOT EXISTS idx_pp_tenant_status (tenant_id, status, submitted_at);

ALTER TABLE payroll_runs
  DROP INDEX uniq_payroll_run,
  ADD UNIQUE KEY uniq_payroll_run_scope (tenant_id, branch_id, month, year);

UPDATE payment_proofs pp
JOIN orders o
  ON o.subscriber_id = pp.subscriber_id
 AND o.status = 'PENDING'
 AND (pp.course_id IS NULL OR o.course_id = pp.course_id)
SET pp.order_id = o.id,
    pp.item_type = LOWER(o.type),
    pp.bundle_id = o.bundle_id,
    pp.tenant_id = o.tenant_id,
    pp.branch_id = o.branch_id
WHERE pp.order_id IS NULL;
