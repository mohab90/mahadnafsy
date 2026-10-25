-- The cash boxes' current balances (25 Oct 2026).
--
-- «كل وسيلة دفع وفيها كام … رصيد حالي غير دخل اليوم … ونقدر نصفّر العداد ونعدّل الرصيد العام»: a box's balance is its
-- opening amount plus the paid payments that came into it after its baseline (lib/boxBalances.js). A reset moves the baseline
-- to now and the opening to 0; a correction moves only the opening. The payments are never rewritten. «__general__» holds the
-- general adjustment of a currency, so setting the overall balance never edits a single box.
CREATE TABLE IF NOT EXISTS box_balances (
  tenant_id VARCHAR(64) NOT NULL,
  method VARCHAR(191) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'EGP',
  opening_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  baseline_at DATETIME NULL,
  updated_by VARCHAR(255) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, method, currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every change to a balance: what it was, what it became, who and why.
CREATE TABLE IF NOT EXISTS box_balance_events (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  method VARCHAR(191) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'EGP',
  kind ENUM('reset','set_balance','set_total','reset_all') NOT NULL,
  balance_before DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  balance_after DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  note VARCHAR(500) NULL,
  actor VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_box_balance_events (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
