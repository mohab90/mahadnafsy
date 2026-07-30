'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('manual money workflows separate recording, approval and refund authority', () => {
  const createPayment = read('api/routes/subscriber-payments.js');
  const approvePayment = read('api/routes/core/financepay.js');
  const refundRoute = read('api/routes/finance.js');

  assert.match(createPayment, /hasPermission\(req\.staffRecord,\s*'manage_financial'\)/);
  assert.match(createPayment, /storedStatus = requestedStatus === 'paid' && !canApprovePayment \? 'pending'/);
  assert.match(createPayment, /const scope = resolveFinancialScope\(req/);
  assert.match(createPayment, /financialRecordMatches\(scope, subRow\)/);
  assert.match(createPayment, /if \(isPaid && linkedLeadId\)/);
  assert.match(approvePayment, /payments\/:id\/status'[\s\S]{0,180}requirePermission\('manage_financial'\)/);
  assert.match(approvePayment, /\[status,\s*id,\s*payment\.transaction_id \|\| id,\s*tenantId,\s*payment\.branch_id \|\| null\]/);
  assert.match(approvePayment, /enqueueFinanceEvent\(/);
  assert.match(approvePayment, /const scope = resolveFinancialScope\(req/);
  assert.match(approvePayment, /financialRecordMatches\(scope, payment\)/);
  assert.match(approvePayment, /UPDATE orders[\s\S]{0,260}branch_id <=> \?/);
  assert.match(refundRoute, /finance\/refunds\/:id'[\s\S]{0,180}requirePermission\('approve_refunds'\)/);
  assert.match(refundRoute, /Refund request has already been resolved/);
});

test('proof and manual-journal inputs fail closed at the API boundary', () => {
  const proofRoute = read('api/routes/payment-proofs.js');
  const accounting = read('api/routes/accounting-erp.js');
  const finance = read('api/lib/finance.js');

  assert.match(proofRoute, /LEFT JOIN subscribers s ON s\.id = pp\.subscriber_id AND s\.tenant_id=pp\.tenant_id/);
  assert.match(proofRoute, /inspectProofImageDataUrl\(proof_image\)/);
  assert.match(accounting, /Number\.isFinite\(line\.debit\)/);
  assert.match(accounting, /await conn\.beginTransaction\(\);[\s\S]{0,100}await assertWritable/);
  assert.match(finance, /await assertWritable\(date, conn, tenantId\)/);
  assert.match(finance, /Math\.abs\(totalDebit - totalCredit\) >= 0\.01/);
});

test('payment audit is tenant scoped and the reference schema has no duplicate columns', () => {
  const finance = read('api/lib/finance.js');
  const migration = read('api/migrations/143_v25_finance_audit_tenant_scope.sql');
  const schema = read('api/schema.sql');
  assert.match(finance, /INSERT INTO payment_audit_log[\s\S]{0,180}tenant_id/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS tenant_id/);
  assert.match(migration, /MODIFY COLUMN action VARCHAR\(80\)/);

  for (const table of schema.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\r?\n\) ENGINE/g)) {
    const names = [...table[2].matchAll(/^\s*`([^`]+)`/gm)].map(match => match[1]);
    assert.equal(new Set(names).size, names.length, `duplicate column in schema table ${table[1]}`);
  }
});

test('production readiness rejects stale or fallback FX snapshots', () => {
  const readiness = read('api/tools/production-readiness.cjs');
  const config = read('api/routes/config.js');
  assert.match(readiness, /snapshot\.source !== 'static-fallback'/);
  assert.match(readiness, /ageHours <= 72/);
  assert.match(config, /'exchange\.source': 'open\.er-api\.com'/);
  assert.match(config, /'exchange\.updated_at': updatedAt/);
});

test('lead payments use the transactional payment API before enrollment or conversion truth', () => {
  const sharedHandler = read('admin/pages/dashboard/dashboardPaymentHandlers.ts');
  const paymentRoute = read('api/routes/subscriber-payments.js');
  const leadsTab = read('admin/pages/dashboard/tabs/leads/useLeadActions.ts');
  const unifiedClient = read('admin/pages/UnifiedClientPage.tsx');
  const unifiedPayments = read('admin/pages/unified-client/useUnifiedClientPayments.ts');
  const unifiedLifecycle = read('admin/pages/unified-client/useUnifiedClientLifecycleActions.ts');

  assert.match(sharedHandler, /payEntries\.length !== 1/);
  assert.match(sharedHandler, /mysqlAdmin\.saveLeadPayment\([\s\S]*freshLead\.id/);
  assert.doesNotMatch(sharedHandler, /for \(const entry of payEntries\)/);
  assert.match(paymentRoute, /if \(createFromLead\)[\s\S]*LIMIT 1 FOR UPDATE/);
  assert.match(paymentRoute, /INSERT INTO subscribers[\s\S]*INSERT INTO payments[\s\S]*postPaymentJournal[\s\S]*await conn\.commit/);
  assert.match(paymentRoute, /subscriberCreated: createFromLead/);
  assert.match(sharedHandler, /await Promise\.all\(\[reloadSubscribers\(\),\s*reloadLeads\(\)\]\)/);
  assert.match(leadsTab, /await handleLeadPaymentFn\(draft/);
  assert.match(unifiedClient, /useUnifiedClientPayments\(/);
  assert.match(unifiedClient, /useUnifiedClientLifecycleActions\(/);
  assert.match(unifiedPayments, /await recordSubscriberPayment\(subscriberId,/);
  assert.match(unifiedLifecycle, /await mysqlAdmin\.convertLead\(lead\.id/);
});

test('financial statements and payroll money transitions use ledger and finance authority', () => {
  const reports = read('api/routes/analytics/financial.js');
  const payroll = read('api/routes/hr/payroll.js');
  const periods = read('api/routes/accounting.js');
  const periodUi = read('admin/pages/dashboard/tabs/FinancialPanels.tsx');

  assert.match(reports, /balance-sheet[\s\S]{0,1800}journal_entry_lines/);
  assert.match(reports, /cash-flow[\s\S]{0,1800}jel\.account_code='1100'/);
  assert.match(reports, /vat-summary[\s\S]{0,1800}jel\.account_code LIKE '4%'/);
  assert.match(payroll, /\['APPROVED', 'PAID'\]\.includes\(status\) && !canManageFinance/);
  assert.match(periods, /reopen[\s\S]{0,500}requireAdmin/);
  assert.match(periods, /reopen[\s\S]{0,900}reason/);
  for (const check of [
    'paid_without_journal',
    'unbalanced_journals',
    'expenses_without_journal',
    'refunds_without_journal',
    'payroll_without_journal',
    'pending_payments',
    'failed_finance_events',
  ]) {
    assert.match(periods, new RegExp(check));
  }
  assert.match(periods, /Object\.entries\(integrity\)\.filter/);
  assert.match(periodUi, /window\.prompt\([\s\S]{0,300}adminPost\([\s\S]{0,100}\{ reason \}/);
});

test('recurring expenses preserve branch, category and accounting audit history', () => {
  const reports = read('api/routes/analytics/financial.js');
  const migration = read('api/migrations/109_v25_recurring_expense_branch_scope.sql');
  const ui = read('admin/pages/dashboard/tabs/RecurringExpensesTab.tsx');

  assert.match(reports, /recurring-expenses[\s\S]{0,1400}resolveFinancialScope/);
  assert.match(reports, /INSERT INTO expenses[\s\S]{0,300}branch_id/);
  assert.match(reports, /postExpenseJournal\([\s\S]{0,220}branch_id: rec\.branch_id/);
  assert.match(reports, /UPDATE recurring_expenses[\s\S]{0,240}deleted_at=NOW\(\)/);
  assert.match(migration, /branch_id VARCHAR\(36\)/);
  assert.match(migration, /frequency ENUM\('monthly','weekly','quarterly','yearly'\)/);
  assert.match(ui, /CATEGORY_LABELS[\s\S]{0,500}SALARIES/);
});

test('payment links fail closed without configuration, redeem once, and installment reads enforce scope', () => {
  const finance = read('api/routes/finance.js');
  const checkout = read('api/routes/lead-capture-crm.js');
  const installments = read('api/routes/installments.js');
  assert.match(finance, /PAYMENT_LINKS_ENABLED !== 'true'/);
  assert.match(finance, /PAYMENT_LINK_CHECKOUT_URL_TEMPLATE/);
  assert.doesNotMatch(finance, /mahadnafsy\.com\/#\/pay/);
  assert.match(checkout, /used_at=NOW\(\),used_by_order_id=\?/);
  assert.match(checkout, /used_at IS NULL AND expires_at>NOW\(\)/);
  assert.doesNotMatch(finance, /installment_plans[\s\S]{0,160}next_due_date/);
  assert.match(finance, /JSON_EXTRACT\([\s\S]{0,180}ip\.due_dates/);
  assert.match(installments, /requireScopedSubscriber/);
  assert.match(installments, /resolveFinancialScope\(req,\s*\{\s*allowAssigned:\s*true\s*\}\)/);
  assert.match(installments, /financialRecordMatches/);
});

test('expense UI waits for the server ledger and the API preserves category, branch and editable fields', () => {
  const route = read('api/routes/admin-operations.js');
  const state = read('admin/context/site-data-hooks/useExpensesState.ts');
  const panel = read('admin/pages/dashboard/tabs/financial/FinancialExpensesPanel.tsx');
  const runtime = read('admin/context/site-data-hooks/useAdminDataRuntime.ts');
  assert.match(route, /expenses'.*requireAdminOrStaff, requirePermission\('view_financial'\)/);
  assert.match(route, /expenses'.*requireAdminOrStaff, requirePermission\('manage_financial'\)/);
  assert.match(route, /EXPENSE_CATEGORY_DB/);
  assert.match(route, /deleted_at IS NULL/);
  assert.match(route, /financialRecordMatches\(sourceScope, oldExp\)/);
  assert.match(route, /SET description=\?, amount=\?, currency=\?, category=\?, date=\?, receipt_url=\?, note=\?, branch_id=\?/);
  assert.match(route, /\{ id, tenant_id: tenantId, branch_id: branchId/);
  assert.match(state, /await mysqlAdmin\.saveExpense/);
  assert.match(state, /await mysqlAdmin\.updateExpense/);
  assert.match(state, /await mysqlAdmin\.deleteExpense/);
  assert.match(panel, /await updateExpense/);
  assert.match(panel, /await addExpense/);
  assert.match(panel, /await deleteExpense/);
  assert.match(runtime, /if \(expensesRes\.status === 'fulfilled'\) setExpenses/);
  assert.equal((runtime.match(/if \(expensesRes\.status === 'fulfilled'\) setExpenses/g) || []).length, 2);
});

test('payment review and certificate settlement preserve tenant and workflow identity', () => {
  const payments = read('api/routes/payments.js');
  const paymentProofs = read('api/routes/payment-proofs.js');
  const createPayment = read('api/routes/subscriber-payments.js');
  const approvePayment = read('api/routes/core/financepay.js');
  const certificateLink = read('api/lib/certificatePayments.js');
  const schema = read('api/migrations/105_v25_certificate_payment_link.sql');

  assert.match(payments, /LEFT JOIN subscribers s ON s\.id = p\.subscriber_id AND s\.tenant_id=p\.tenant_id/);
  assert.match(payments, /SELECT id FROM subscribers[\s\S]{0,120}tenant_id=\?/);
  assert.match(payments, /pp\.tenant_id=orders\.tenant_id/);
  assert.match(paymentProofs, /const scope = resolveFinancialScope\(req/);
  assert.match(paymentProofs, /sql \+= ' AND pp\.branch_id=\?'/);
  assert.match(paymentProofs, /financialRecordMatches\(scope, proof\)/);
  assert.match(paymentProofs, /SELECT proof_image, branch_id[\s\S]{0,300}financialRecordMatches\(scope, row\)/);
  assert.match(createPayment, /certificate_request_id/);
  assert.match(createPayment, /await applyCertificatePayment/);
  assert.match(approvePayment, /await applyCertificatePayment\(payment,\s*conn,\s*tenantId\)/);
  assert.match(certificateLink, /FROM certificate_requests[\s\S]{0,120}FOR UPDATE/);
  assert.match(schema, /certificate_request_id VARCHAR\(36\)/);
});

test('account onboarding and finance screens keep payments in the ledger-backed workflow', () => {
  const auth = read('api/routes/auth.js');
  const onlineClients = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  const financialTab = read('admin/pages/dashboard/tabs/FinancialTab.tsx');
  const financialRows = read('admin/pages/dashboard/tabs/financial/useFinancialOrdersData.ts');
  const subscriberRoute = read('api/routes/admin/subscribers.js');
  const subscriberPayments = read('api/routes/subscriber-payments.js');
  const courseDetails = read('admin/pages/dashboard/tabs/OnlineClientCourseDetailsModal.tsx');

  assert.match(auth, /firstPaymentStatus = canApproveFinancial \? 'paid' : 'pending'/);
  assert.match(auth, /paymentBundleId/);
  assert.match(auth, /if \(firstPaymentStatus === 'paid'\)[\s\S]{0,250}postPaymentJournal/);
  assert.match(onlineClients, /firstPayment:[\s\S]{0,1000}courseExpected/);
  assert.match(onlineClients, /adminPost<[\s\S]{0,220}\/admin\/subscriber-payments/);
  assert.doesNotMatch(onlineClients, /تم إنشاء العميل لكن الدفعة لم تُسجل/);
  assert.match(subscriberPayments, /if \(createFromDraft\)[\s\S]{0,2200}INSERT INTO subscribers/);
  assert.match(subscriberPayments, /await conn\.commit\(\)/);
  assert.match(financialTab, /mysqlAdmin\.getFinancialPnl/);
  assert.match(financialTab, /ledgerAllPnl\?\.totalRevenue/);
  assert.match(financialRows, /onlinePaymentRefs/);
  assert.match(subscriberRoute, /delete crmData\.paymentHistory/);
  assert.doesNotMatch(courseDetails, /newPayHistory/);
  assert.match(courseDetails, /يتغير فقط من تسجيل\/اعتماد دفعة/);
});

test('manual payment retries the complete transaction after transient MySQL deadlocks', () => {
  const route = read('api/routes/subscriber-payments.js');

  assert.match(route, /TRANSIENT_TX_ERRORS = new Set\(\['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'\]\)/);
  assert.match(route, /for \(let transactionAttempt = 1; ; transactionAttempt \+= 1\)/);
  assert.match(route, /await conn\.rollback\(\)[\s\S]{0,350}transactionAttempt >= 3/);
  assert.match(route, /SELECT GET_LOCK\(\?, 5\) AS acquired/);
  assert.match(route, /SELECT RELEASE_LOCK\(\?\)/);
  assert.match(route, /retrying rolled-back transaction/);
});

test('certificate lifecycle and receipt rendering fail closed', () => {
  const certificates = read('api/routes/certificates.js');
  const certTab = read('admin/pages/dashboard/tabs/CertRequestsTab.tsx');
  const receiptTable = read('admin/pages/dashboard/tabs/financial/FinancialOrdersTable.tsx');
  const receiptClient = read('admin/pages/unified-client/UnifiedClientSubscriberPaymentsPanel.tsx');
  const safeHtml = read('admin/lib/safeHtml.ts');

  assert.match(certificates, /certificate_request_id=\?/);
  assert.match(certificates, /Paid or financially linked certificate requests cannot be deleted/);
  assert.match(certificates, /Certificate issuance requires linked payment, enrollment, and course completion/);
  assert.match(certificates, /'SHIPPED'/);
  assert.match(certTab, /await mysqlAdmin\.updateCertificateRequest/);
  assert.match(certTab, /await mysqlAdmin\.deleteCertificateRequest/);
  assert.match(safeHtml, /replace\(\/\[&<>\"'\]\/g/);
  assert.match(receiptTable, /escapeHtml\(row\.name\)/);
  assert.match(receiptClient, /escapeHtml\(clientName\)/);
});
