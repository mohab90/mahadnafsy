'use strict';

const { uuidv4 } = require('./id');

const PREFIX = { invoice: 'INV', credit_note: 'CN' };

function issuedDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw new Error('Invalid financial document date');
  return date;
}

async function issueFinancialDocument(db, {
  tenantId, branchId = null, documentType, sourceType, sourceId,
  amount, currency, issuedAt, actor, relatedDocumentId = null,
}) {
  if (!PREFIX[documentType]) throw new Error('Unsupported financial document type');
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('Invalid financial document amount');
  const [[existing]] = await db.query(
    `SELECT * FROM financial_documents
      WHERE tenant_id=? AND document_type=? AND source_type=? AND source_id=?
      LIMIT 1 FOR UPDATE`,
    [tenantId, documentType, sourceType, sourceId]
  );
  if (existing) return existing;

  const date = issuedDate(issuedAt);
  const year = date.getUTCFullYear();
  const branchScope = branchId || '__CENTRAL__';
  await db.query(
    `INSERT INTO finance_document_sequences
       (tenant_id,branch_scope,document_type,document_year,next_number)
     VALUES (?,?,?,?,2)
     ON DUPLICATE KEY UPDATE next_number=next_number+1`,
    [tenantId, branchScope, documentType, year]
  );
  const [[sequence]] = await db.query(
    `SELECT next_number FROM finance_document_sequences
      WHERE tenant_id=? AND branch_scope=? AND document_type=? AND document_year=?
      LIMIT 1 FOR UPDATE`,
    [tenantId, branchScope, documentType, year]
  );
  const number = Number(sequence.next_number) - 1;
  const documentNumber = `${PREFIX[documentType]}-${year}-${String(number).padStart(6, '0')}`;
  const id = uuidv4();
  await db.query(
    `INSERT INTO financial_documents
       (id,tenant_id,branch_id,document_type,document_number,source_type,source_id,
        related_document_id,amount,currency,issued_at,issued_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, tenantId, branchId, documentType, documentNumber, sourceType, sourceId,
     relatedDocumentId, numericAmount, currency, date, actor || 'system']
  );
  return {
    id, tenant_id: tenantId, branch_id: branchId, document_type: documentType,
    document_number: documentNumber, source_type: sourceType, source_id: sourceId,
    related_document_id: relatedDocumentId, amount: numericAmount, currency,
  };
}

async function ensureInvoiceForPayment(db, payment, actor) {
  return issueFinancialDocument(db, {
    tenantId: payment.tenant_id,
    branchId: payment.branch_id || null,
    documentType: 'invoice',
    sourceType: 'payment',
    sourceId: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    issuedAt: payment.date || payment.created_at,
    actor,
  });
}

module.exports = { ensureInvoiceForPayment, issueFinancialDocument };
