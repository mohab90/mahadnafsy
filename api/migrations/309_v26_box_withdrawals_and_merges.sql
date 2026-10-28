-- Withdrawals from a cash box, and boxes merged into one (28 Oct 2026).
--
-- «في ارصدة الخزن يبقى في زر سحب من الرصيد ونحدد التوجيه المحاسبي له، وممكن يكون سحب شخصي مهاب أو وليد لأنهم شركاء، ومحتاجين جدول بالأرصدة اللي سحبها
-- مهاب واللي سحبها وليد من كل الخزن» + «فودافون كاش 1010 هو هو فودافون كاش 1079».
--
-- A box's balance is its opening amount plus the paid payments after its baseline (lib/boxBalances.js); a withdrawal after the baseline takes
-- its amount out, and the books get one entry: debit the account it was directed to (a partner's drawings, an expense, any account of the
-- chart), credit cash 1100. A transfer to another box moves money between two boxes and posts nothing (both are in 1100). A withdrawal is
-- never deleted: voiding it marks it and posts the reversing entry.
CREATE TABLE IF NOT EXISTS box_withdrawals (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  method VARCHAR(191) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'EGP',
  amount DECIMAL(14,2) NOT NULL,
  kind ENUM('partner','expense','transfer','other') NOT NULL,
  partner VARCHAR(32) NULL,
  to_method VARCHAR(191) NULL,
  account_code VARCHAR(32) NULL,
  account_name VARCHAR(255) NULL,
  journal_entry_id VARCHAR(36) NULL,
  note VARCHAR(500) NULL,
  withdrawn_on DATE NOT NULL,
  actor VARCHAR(255) NULL,
  voided_at DATETIME NULL,
  voided_by VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_box_withdrawals (tenant_id, created_at),
  KEY idx_box_withdrawals_partner (tenant_id, partner, withdrawn_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A box that is the same box as another under a different name («فودافون كاش 1079» is «فودافون كاش 1010»): what was typed on its payments
-- is not rewritten, the name is read through this table (lib/boxAliases.js).
CREATE TABLE IF NOT EXISTS box_aliases (
  tenant_id VARCHAR(64) NOT NULL,
  alias VARCHAR(191) NOT NULL,
  target VARCHAR(191) NOT NULL,
  created_by VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, alias)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE box_balance_events
  MODIFY kind ENUM('reset','set_balance','set_total','reset_all','withdraw','transfer','merge','void_withdrawal') NOT NULL;
