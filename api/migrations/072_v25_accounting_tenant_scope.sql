-- Tenant-native accounting foundation. The legacy chart used `code` as a
-- global primary key, so keep it as a compatibility source and introduce a
-- composite tenant chart instead of changing a live primary key in place.
CREATE TABLE IF NOT EXISTS tenant_chart_of_accounts (
  tenant_id VARCHAR(64) NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, code),
  KEY idx_tenant_chart_active (tenant_id, is_active, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO tenant_chart_of_accounts
  (tenant_id, code, name, type, is_active, created_at, updated_at)
SELECT 'tenant-default', code, name, type, is_active, created_at, updated_at
FROM chart_of_accounts;

INSERT IGNORE INTO tenant_chart_of_accounts (tenant_id, code, name, type)
SELECT 'tenant-default', account_code, MAX(account_name),
  CASE LEFT(account_code, 1)
    WHEN '1' THEN 'asset' WHEN '2' THEN 'liability'
    WHEN '3' THEN 'equity' WHEN '4' THEN 'revenue' ELSE 'expense' END
FROM journal_entry_lines
WHERE account_code <> ''
GROUP BY account_code;

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD INDEX IF NOT EXISTS idx_journal_tenant_date (tenant_id, entry_date),
  ADD INDEX IF NOT EXISTS idx_journal_tenant_ref (tenant_id, ref_type, ref_id);

ALTER TABLE accounting_periods
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD COLUMN IF NOT EXISTS open_guard TINYINT GENERATED ALWAYS AS (CASE WHEN status='open' THEN 1 ELSE NULL END) STORED,
  ADD UNIQUE INDEX IF NOT EXISTS uq_period_tenant_label (tenant_id, period_label),
  ADD UNIQUE INDEX IF NOT EXISTS uq_period_single_open (tenant_id, open_guard),
  ADD INDEX IF NOT EXISTS idx_period_tenant_status (tenant_id, status, opened_at);
