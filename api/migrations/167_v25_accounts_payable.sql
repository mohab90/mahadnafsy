CREATE TABLE IF NOT EXISTS finance_vendors (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  tax_id VARCHAR(80) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(50) NULL,
  currency ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  payment_terms_days SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_finance_vendors_tenant_active (tenant_id,is_active,name),
  CONSTRAINT chk_finance_vendor_terms CHECK (payment_terms_days <= 365)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accounts_payable_invoices (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  vendor_id VARCHAR(36) NOT NULL,
  branch_id VARCHAR(36) NOT NULL,
  invoice_number VARCHAR(120) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  currency ENUM('EGP','SAR','USD') NOT NULL,
  subtotal DECIMAL(18,2) NOT NULL,
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(18,2) NOT NULL,
  amount_egp DECIMAL(18,2) NULL,
  fx_rate_to_egp DECIMAL(18,8) NULL,
  expense_account_code VARCHAR(20) NOT NULL DEFAULT '5900',
  liability_account_code VARCHAR(20) NOT NULL DEFAULT '2200',
  description VARCHAR(1000) NULL,
  status ENUM('draft','approved','partially_paid','paid','void') NOT NULL DEFAULT 'draft',
  created_by VARCHAR(100) NOT NULL,
  approved_by VARCHAR(100) NULL,
  approved_at DATETIME NULL,
  approval_journal_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ap_vendor_invoice (tenant_id,vendor_id,invoice_number),
  KEY idx_ap_due (tenant_id,status,due_date),
  KEY idx_ap_branch_date (tenant_id,branch_id,invoice_date),
  CONSTRAINT fk_ap_vendor FOREIGN KEY (vendor_id) REFERENCES finance_vendors(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ap_amounts CHECK (
    subtotal >= 0 AND tax_amount >= 0 AND total_amount > 0
    AND ABS(total_amount - subtotal - tax_amount) < 0.01
  ),
  CONSTRAINT chk_ap_dates CHECK (due_date >= invoice_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accounts_payable_payments (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  payable_id VARCHAR(36) NOT NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  currency ENUM('EGP','SAR','USD') NOT NULL,
  amount_egp DECIMAL(18,2) NOT NULL,
  bank_account_code VARCHAR(20) NOT NULL DEFAULT '1100',
  reference VARCHAR(191) NOT NULL,
  journal_entry_id VARCHAR(36) NOT NULL,
  paid_by VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ap_payment_reference (tenant_id,reference),
  KEY idx_ap_payments_payable (tenant_id,payable_id,payment_date),
  CONSTRAINT fk_ap_payment_invoice FOREIGN KEY (payable_id) REFERENCES accounts_payable_invoices(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ap_payment_amount CHECK (amount > 0 AND amount_egp > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
