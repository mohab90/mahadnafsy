ALTER TABLE instructor_fees
  ADD COLUMN IF NOT EXISTS source_payment_id VARCHAR(100) NULL AFTER course_id,
  ADD UNIQUE INDEX IF NOT EXISTS uq_instructor_fee_payment (tenant_id,source_payment_id);

ALTER TABLE crm_commissions
  DROP INDEX IF EXISTS uniq_comm_payment_staff,
  ADD UNIQUE INDEX IF NOT EXISTS uq_commission_payment_staff (tenant_id,payment_id,staff_id);
