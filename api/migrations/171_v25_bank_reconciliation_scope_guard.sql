ALTER TABLE bank_reconciliations
  ADD COLUMN branch_scope VARCHAR(36)
    GENERATED ALWAYS AS (COALESCE(branch_id,'__CENTRAL__')) STORED,
  DROP INDEX uq_bank_reconciliation_period,
  ADD UNIQUE KEY uq_bank_reconciliation_period
    (tenant_id,account_code,branch_scope,period_start,period_end);
