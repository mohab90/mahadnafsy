-- 026_chart_of_accounts.sql
-- Admin-managed Chart of Accounts on top of the existing ledger
-- (journal_entries / journal_entry_lines). Ported from the 26 line.
--
-- Idempotent: routes/accounting-erp.js also creates this at load and bootstraps
-- it from the accounts already used in journal_entry_lines (type inferred from the
-- code prefix), so the chart is immediately populated with the institute's real
-- accounts. This file is the migration-of-record.

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  code VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO chart_of_accounts (code, name, type)
SELECT account_code, MAX(account_name),
  CASE LEFT(account_code, 1)
    WHEN '1' THEN 'asset' WHEN '2' THEN 'liability'
    WHEN '3' THEN 'equity' WHEN '4' THEN 'revenue' ELSE 'expense' END
FROM journal_entry_lines WHERE account_code <> '' GROUP BY account_code;
