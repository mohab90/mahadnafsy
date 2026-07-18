CREATE TABLE IF NOT EXISTS chart_of_accounts (
  code VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS journal_entries (
  id           VARCHAR(36)    NOT NULL,
  ref_type     VARCHAR(50)    NOT NULL COMMENT 'payment | refund | payroll | adjustment | manual',
  ref_id       VARCHAR(36)    NULL,
  entry_date   DATE           NOT NULL,
  description  TEXT           NULL,
  total_debit  DECIMAL(12,2)  NOT NULL DEFAULT 0,
  total_credit DECIMAL(12,2)  NOT NULL DEFAULT 0,
  posted_by    VARCHAR(200)   NULL,
  created_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_je_ref  (ref_type, ref_id),
  KEY idx_je_date (entry_date),
  KEY idx_je_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id           VARCHAR(36)    NOT NULL,
  entry_id     VARCHAR(36)    NOT NULL,
  account_code VARCHAR(32)    NOT NULL,
  account_name VARCHAR(200)   NOT NULL,
  debit        DECIMAL(12,2)  NOT NULL DEFAULT 0,
  credit       DECIMAL(12,2)  NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_jel_entry (entry_id),
  KEY idx_jel_account_code (account_code),
  CONSTRAINT fk_jel_entry FOREIGN KEY (entry_id) REFERENCES journal_entries (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO chart_of_accounts (code, name, type) VALUES
('1100', 'نقدية وبنوك', 'asset'),
('2100', 'مستحقات الرواتب', 'liability'),
('3100', 'رأس المال', 'equity'),
('4100', 'إيرادات كورسات', 'revenue'),
('4200', 'إيرادات استشارات', 'revenue'),
('4300', 'إيرادات شهادات', 'revenue'),
('4900', 'إيرادات أخرى', 'revenue'),
('5100', 'رواتب موظفين', 'expense'),
('5200', 'إيجارات', 'expense'),
('5300', 'مرافق وخدمات', 'expense'),
('5400', 'برمجيات واشتراكات', 'expense'),
('5500', 'تسويق وإعلانات', 'expense'),
('5600', 'معدات وأجهزة', 'expense'),
('5700', 'صيانة', 'expense'),
('5800', 'انتقالات وسفر', 'expense'),
('5900', 'مصروفات أخرى', 'expense');
