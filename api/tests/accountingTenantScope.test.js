'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('accounting migration creates tenant-native chart and scopes ledger and periods', () => {
  const sql = read('migrations/072_v25_accounting_tenant_scope.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tenant_chart_of_accounts/);
  assert.match(sql, /PRIMARY KEY \(tenant_id, code\)/);
  assert.match(sql, /ALTER TABLE journal_entries[\s\S]*tenant_id/);
  assert.match(sql, /ALTER TABLE accounting_periods[\s\S]*tenant_id/);
  assert.match(sql, /uq_period_single_open \(tenant_id, open_guard\)/);
});

test('chart, balances, manual journals and period locks use request tenant', () => {
  const route = read('routes/accounting-erp.js');
  assert.match(route, /FROM tenant_chart_of_accounts[\s\S]*WHERE tenant_id=\?/);
  assert.match(route, /INNER JOIN journal_entries je[\s\S]*WHERE je\.tenant_id=\?/);
  assert.match(route, /assertWritable\(date, conn, req\.tenantId\)/);
  assert.match(route, /INSERT INTO journal_entries \(id, tenant_id/);
});

test('journal core writes tenant header and tenant chart in the same transaction', () => {
  const finance = read('lib/finance.js');
  assert.match(finance, /INSERT INTO journal_entries \(id, tenant_id/);
  assert.match(finance, /INSERT IGNORE INTO tenant_chart_of_accounts \(tenant_id, code, name, type\)/);
  assert.match(finance, /actor \|\| 'system', db, tenantId/);
});

test('accounting periods and snapshots are tenant scoped', () => {
  const route = read('routes/accounting.js');
  assert.match(route, /accounting_periods WHERE tenant_id=\?/);
  assert.match(route, /FROM payments WHERE tenant_id=\? AND status='paid'/);
  assert.match(route, /WHERE tenant_id=\? AND deleted_at IS NULL/);
  assert.match(route, /tenantId: req\.tenantId/);
});

test('expense writes and ledger postings share one transaction', () => {
  const route = read('routes/admin-operations.js');
  assert.match(route, /await conn\.beginTransaction\(\)/);
  assert.match(route, /postExpenseJournal\([\s\S]*conn, tenantId/);
  assert.match(route, /if \(!journalId\) throw new Error\('Expense journal posting failed'\)/);
  assert.doesNotMatch(route, /postExpenseJournal\([^;]+\.catch\(\(\) => \{\}\)/);
});

test('financial reports and reconciliation scope journal headers by tenant', () => {
  const financeRoute = read('routes/finance.js');
  const monitoring = read('routes/monitoring.js');
  assert.match(financeRoute, /WHERE je\.tenant_id=\? AND je\.entry_date BETWEEN/);
  assert.match(monitoring, /WHERE je\.tenant_id=\? AND je\.ref_type='payment'/);
  assert.match(monitoring, /je\.tenant_id=p\.tenant_id/);
});

test('reconciliation dashboard connects payments, journals, enrollments, CRM and orders per tenant', () => {
  const route = read('routes/core/payops.js');
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'financial', 'ReconciliationPanel.tsx'), 'utf8');
  assert.match(route, /reconciliation-dashboard'[\s\S]*requirePermission\('view_financial'\)/);
  assert.match(route, /paid_without_journal[\s\S]*je\.tenant_id=p\.tenant_id/);
  assert.match(route, /paid_without_enrollment[\s\S]*e\.tenant_id=p\.tenant_id/);
  assert.match(route, /converted_without_subscriber[\s\S]*s\.tenant_id=l\.tenant_id/);
  assert.match(route, /paid_order_without_payment[\s\S]*p\.tenant_id=o\.tenant_id/);
  assert.match(route, /failed_finance_events[\s\S]*FROM finance_outbox[\s\S]*WHERE tenant_id=\?/);
  assert.match(ui, /\/api\/admin\/reconciliation-dashboard/);
});

test('finance outbox is tenant scoped, retryable and connected to payment producers and worker', () => {
  const migration = read('migrations/081_v25_finance_outbox_tenant_retry.sql');
  const outbox = read('lib/financeOutbox.js');
  const payments = read('routes/subscriber-payments.js');
  const proofs = read('routes/payment-proofs.js');
  const payops = read('routes/core/payops.js');
  const server = read('server.js');
  assert.match(migration, /tenant_id VARCHAR\(64\)/);
  assert.match(migration, /uq_finance_outbox_tenant_dedupe \(tenant_id, dedupe_key\)/);
  assert.match(migration, /locked_by VARCHAR\(100\)/);
  assert.match(outbox, /WHERE id=\? AND tenant_id=\?/);
  assert.match(outbox, /attempts >= MAX_ATTEMPTS/);
  assert.match(outbox, /LIMIT \? FOR UPDATE/);
  assert.match(outbox, /status='processing'[\s\S]*locked_by=\?/);
  assert.match(payments, /enqueueFinanceEvent\([\s\S]*tenantId/);
  assert.match(proofs, /enqueueFinanceEvent\([\s\S]*tenantId/);
  assert.match(server, /drainFinanceOutbox\([\s\S]*sync_lead_deal_value/);
  assert.match(payops, /finance-outbox\/:id\/retry'[\s\S]*requirePermission\('manage_financial'\)/);
  assert.match(payops, /retryFinanceEvent\(req\.params\.id, req\.tenantId\)/);
});
