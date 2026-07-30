-- CRM opportunity forecasting: explicit close date/category/probability plus
-- append-only rep/manager submissions. Values are canonical EGP snapshots.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS forecast_category ENUM('pipeline','best_case','commit') NULL AFTER deal_value,
  ADD COLUMN IF NOT EXISTS expected_close_date DATE NULL AFTER forecast_category,
  ADD COLUMN IF NOT EXISTS forecast_probability DECIMAL(5,2) NULL AFTER expected_close_date,
  ADD COLUMN IF NOT EXISTS forecast_updated_by VARCHAR(64) NULL AFTER forecast_probability,
  ADD COLUMN IF NOT EXISTS forecast_updated_at DATETIME NULL AFTER forecast_updated_by,
  ADD INDEX IF NOT EXISTS idx_leads_tenant_forecast_close
    (tenant_id, expected_close_date, forecast_category, assigned_sales_id, hidden);

CREATE TABLE IF NOT EXISTS crm_forecast_submissions (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  period CHAR(7) NOT NULL,
  staff_id VARCHAR(64) NOT NULL,
  pipeline_egp DECIMAL(18,2) NOT NULL DEFAULT 0,
  best_case_egp DECIMAL(18,2) NOT NULL DEFAULT 0,
  commit_egp DECIMAL(18,2) NOT NULL DEFAULT 0,
  note VARCHAR(1000) NULL,
  submitted_by VARCHAR(64) NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_crm_forecast_submission_latest
    (tenant_id, period, staff_id, submitted_at),
  CONSTRAINT chk_crm_forecast_submission_amounts CHECK (
    pipeline_egp >= 0 AND best_case_egp >= 0 AND commit_egp >= 0
    AND commit_egp <= best_case_egp AND best_case_egp <= pipeline_egp
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
