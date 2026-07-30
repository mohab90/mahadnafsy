'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { issueFinancialDocument } = require('../lib/financialDocuments');

test('financial documents allocate immutable tenant/branch/year sequences', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM financial_documents')) return [[]];
      if (sql.includes('SELECT next_number FROM finance_document_sequences')) {
        return [[{ next_number: 8 }]];
      }
      return [{}];
    },
  };
  const document = await issueFinancialDocument(db, {
    tenantId: 'tenant-a',
    branchId: 'branch-daqqi',
    documentType: 'invoice',
    sourceType: 'payment',
    sourceId: 'payment-1',
    amount: 500,
    currency: 'EGP',
    issuedAt: '2026-07-30',
    actor: 'accountant',
  });
  assert.equal(document.document_number, 'INV-2026-000007');
  assert.ok(calls.some(call => call.sql.includes('finance_document_sequences')));
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO financial_documents')));
});

test('financial document source is idempotent and consumes no second number', async () => {
  let calls = 0;
  const existing = { id: 'doc-1', document_number: 'CN-2026-000003' };
  const db = { query: async () => { calls++; return [[existing]]; } };
  const document = await issueFinancialDocument(db, {
    tenantId: 'tenant-a',
    documentType: 'credit_note',
    sourceType: 'payment_refund',
    sourceId: 'payment-1',
    amount: 500,
    currency: 'EGP',
  });
  assert.equal(document, existing);
  assert.equal(calls, 1);
});
