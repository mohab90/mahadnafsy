INSERT IGNORE INTO financial_documents
  (id,tenant_id,branch_id,document_type,document_number,source_type,source_id,
   related_document_id,amount,currency,issued_at,issued_by)
SELECT UUID(),ranked.tenant_id,ranked.branch_id,'credit_note',
       CONCAT('CN-',ranked.document_year,'-',LPAD(ranked.sequence_no,6,'0')),
       'payment_refund',ranked.id,ranked.invoice_id,ranked.amount,ranked.currency,
       ranked.issued_at,'migration-174'
  FROM (
    SELECT p.id,p.tenant_id,p.branch_id,p.amount,p.currency,inv.id AS invoice_id,
           COALESCE(p.date,p.created_at,NOW()) AS issued_at,
           YEAR(COALESCE(p.date,p.created_at,NOW())) AS document_year,
           ROW_NUMBER() OVER (
             PARTITION BY p.tenant_id,COALESCE(p.branch_id,'__CENTRAL__'),
                          YEAR(COALESCE(p.date,p.created_at,NOW()))
             ORDER BY COALESCE(p.date,p.created_at),p.id
           ) AS sequence_no
      FROM payments p
      JOIN financial_documents inv
        ON inv.tenant_id=p.tenant_id AND inv.document_type='invoice'
       AND inv.source_type='payment' AND inv.source_id=p.id
     WHERE p.deleted_at IS NULL AND p.status='refunded'
  ) ranked;

INSERT INTO finance_document_sequences
  (tenant_id,branch_scope,document_type,document_year,next_number)
SELECT tenant_id,branch_scope,'credit_note',YEAR(issued_at),COUNT(*)+1
  FROM financial_documents
 WHERE document_type='credit_note'
 GROUP BY tenant_id,branch_scope,YEAR(issued_at)
ON DUPLICATE KEY UPDATE next_number=GREATEST(next_number,VALUES(next_number));
