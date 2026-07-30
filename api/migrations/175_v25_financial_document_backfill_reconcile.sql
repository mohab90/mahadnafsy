INSERT IGNORE INTO financial_documents
  (id,tenant_id,branch_id,document_type,document_number,source_type,source_id,
   related_document_id,amount,currency,issued_at,issued_by)
SELECT UUID(),missing.tenant_id,missing.branch_id,'credit_note',
       CONCAT('CN-',missing.document_year,'-',LPAD(missing.base_number+missing.sequence_no,6,'0')),
       'payment_refund',missing.id,missing.invoice_id,missing.amount,missing.currency,
       missing.issued_at,'migration-175'
  FROM (
    SELECT p.id,p.tenant_id,p.branch_id,p.amount,p.currency,inv.id AS invoice_id,
           COALESCE(p.date,p.created_at,NOW()) AS issued_at,
           YEAR(COALESCE(p.date,p.created_at,NOW())) AS document_year,
           COALESCE(existing.max_number,0) AS base_number,
           ROW_NUMBER() OVER (
             PARTITION BY p.tenant_id,COALESCE(p.branch_id,'__CENTRAL__'),
                          YEAR(COALESCE(p.date,p.created_at,NOW()))
             ORDER BY COALESCE(p.date,p.created_at),p.id
           ) AS sequence_no
      FROM payments p
      JOIN financial_documents inv
        ON inv.tenant_id=p.tenant_id AND inv.document_type='invoice'
       AND inv.source_type='payment' AND inv.source_id=p.id
      LEFT JOIN (
        SELECT tenant_id,branch_scope,YEAR(issued_at) AS document_year,
               MAX(CAST(RIGHT(document_number,6) AS UNSIGNED)) AS max_number
          FROM financial_documents
         WHERE document_type='credit_note'
         GROUP BY tenant_id,branch_scope,YEAR(issued_at)
      ) existing
        ON existing.tenant_id=p.tenant_id
       AND existing.branch_scope=COALESCE(p.branch_id,'__CENTRAL__')
       AND existing.document_year=YEAR(COALESCE(p.date,p.created_at,NOW()))
     WHERE p.deleted_at IS NULL AND p.status='refunded'
       AND NOT EXISTS (
         SELECT 1 FROM financial_documents cn
          WHERE cn.tenant_id=p.tenant_id AND cn.document_type='credit_note'
            AND cn.source_type='payment_refund' AND cn.source_id=p.id
       )
  ) missing;

INSERT INTO finance_document_sequences
  (tenant_id,branch_scope,document_type,document_year,next_number)
SELECT tenant_id,branch_scope,document_type,YEAR(issued_at),
       MAX(CAST(RIGHT(document_number,6) AS UNSIGNED))+1
  FROM financial_documents
 GROUP BY tenant_id,branch_scope,document_type,YEAR(issued_at)
ON DUPLICATE KEY UPDATE next_number=GREATEST(next_number,VALUES(next_number));
