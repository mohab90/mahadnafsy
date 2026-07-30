CREATE TABLE IF NOT EXISTS finance_document_sequences (
  tenant_id VARCHAR(64) NOT NULL,
  branch_scope VARCHAR(36) NOT NULL,
  document_type ENUM('invoice','credit_note') NOT NULL,
  document_year SMALLINT UNSIGNED NOT NULL,
  next_number INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,branch_scope,document_type,document_year),
  CONSTRAINT chk_finance_document_next_number CHECK (next_number > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_documents (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  branch_id VARCHAR(36) NULL,
  branch_scope VARCHAR(36)
    GENERATED ALWAYS AS (COALESCE(branch_id,'__CENTRAL__')) STORED,
  document_type ENUM('invoice','credit_note') NOT NULL,
  document_number VARCHAR(80) NOT NULL,
  source_type VARCHAR(40) NOT NULL,
  source_id VARCHAR(100) NOT NULL,
  related_document_id VARCHAR(36) NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency ENUM('EGP','SAR','USD') NOT NULL,
  issued_at DATETIME NOT NULL,
  issued_by VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_financial_document_number
    (tenant_id,branch_scope,document_type,document_number),
  UNIQUE KEY uq_financial_document_source
    (tenant_id,document_type,source_type,source_id),
  KEY idx_financial_document_issued (tenant_id,document_type,issued_at),
  KEY idx_financial_document_related (tenant_id,related_document_id),
  CONSTRAINT fk_financial_document_related
    FOREIGN KEY (related_document_id) REFERENCES financial_documents(id) ON DELETE RESTRICT,
  CONSTRAINT chk_financial_document_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO financial_documents
  (id,tenant_id,branch_id,document_type,document_number,source_type,source_id,
   amount,currency,issued_at,issued_by)
SELECT UUID(),ranked.tenant_id,ranked.branch_id,'invoice',
       CONCAT('INV-',ranked.document_year,'-',LPAD(ranked.sequence_no,6,'0')),
       'payment',ranked.id,ranked.amount,ranked.currency,ranked.issued_at,'migration-173'
  FROM (
    SELECT p.id,p.tenant_id,p.branch_id,p.amount,p.currency,
           COALESCE(p.date,p.created_at,NOW()) AS issued_at,
           YEAR(COALESCE(p.date,p.created_at,NOW())) AS document_year,
           ROW_NUMBER() OVER (
             PARTITION BY p.tenant_id,COALESCE(p.branch_id,'__CENTRAL__'),
                          YEAR(COALESCE(p.date,p.created_at,NOW()))
             ORDER BY COALESCE(p.date,p.created_at),p.id
           ) AS sequence_no
      FROM payments p
     WHERE p.deleted_at IS NULL AND p.status IN ('paid','refunded')
  ) ranked;

INSERT INTO finance_document_sequences
  (tenant_id,branch_scope,document_type,document_year,next_number)
SELECT tenant_id,branch_scope,'invoice',YEAR(issued_at),COUNT(*)+1
  FROM financial_documents
 WHERE document_type='invoice'
 GROUP BY tenant_id,branch_scope,YEAR(issued_at)
ON DUPLICATE KEY UPDATE next_number=GREATEST(next_number,VALUES(next_number));
