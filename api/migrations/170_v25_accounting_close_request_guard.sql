ALTER TABLE accounting_close_requests
  ADD COLUMN active_guard TINYINT
    GENERATED ALWAYS AS (CASE WHEN status IN ('pending','approved') THEN 1 ELSE NULL END) STORED,
  ADD UNIQUE KEY uq_accounting_close_request_active (tenant_id,period_id,active_guard);
