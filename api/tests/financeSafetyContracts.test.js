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
  // Reopening a closed accounting period must capture a reason and send it.
  //
  // This named window.prompt, which was the mechanism rather than the control —
  // and that mechanism was the problem: a browser may suppress the dialog, and
  // prompt() then returns null, so reopening would silently refuse itself with
  // the message "السبب إلزامي" and no way to proceed. Asserted on the property
  // now: a reason is collected, its absence blocks the call, and it travels
  // with the request.
  assert.match(periodUi, /reopenPeriod[\s\S]{0,200}promptDialog\([\s\S]{0,200}reason/,
    'a reason must still be asked for');
  assert.match(periodUi, /if \(!reason\)[\s\S]{0,200}return;/,
    'no reason must stop the reopen');
  assert.match(periodUi, /adminPost\([\s\S]{0,120}\/reopen[\s\S]{0,60}\{ reason \}/,
    'the reason must reach the server');
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
  // The overdue count comes from the schedule itself, never from a stored
  // next_due_date that can go stale. It used to read the array in SQL at index
  // paid_count — a count, not an index, so a plan whose instalments were
  // settled out of order pointed at the wrong entry and missed the overdue one.
  // It now selects the arrays and walks every entry, which is what the AR-aging
  // screen already did; the guarantee here is the source, not the mechanism.
  assert.doesNotMatch(finance, /installment_plans[\s\S]{0,160}next_due_date/);
  assert.match(finance, /ip\.due_dates, ip\.paid_dates, ip\.payment_ids/);
  assert.match(finance, /!paidDates\[index\] && !paymentIds\[index\]/);
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
  // The category map moved to lib/expenseCategories.js so the budget route can
  // reach it too: budgets are keyed by the Arabic label and expenses by the
  // English code, and with the map locked inside this route the two could never
  // be joined — «الفعلي» read 0 for every category.
  const categories = read('api/lib/expenseCategories.js');
  assert.ok(route.includes("require('../lib/expenseCategories')"));
  assert.match(categories, /EXPENSE_CATEGORY_DB/);
  assert.ok(read('api/routes/finance.js').includes('EXPENSE_CATEGORY_LABEL[s.category]'));
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

// Every route that creates a payment writes its audit row.
//
// Production carries 165 paid payments out of 296 with no provenance at all —
// 56%, including one taken the day this was found. The audit call had been added
// to three of the nine paths that insert into payments and to none of the other
// six, so whether a payment could be traced afterwards depended entirely on
// which screen it came through. The online card payment, the CSV import and the
// historical backfill — the three least traceable ways money can enter — were
// all in the silent group.
//
// Counting calls is what makes this checkable: the file either reaches for
// logPaymentAudit or it does not, and a new payment route added without one
// fails here rather than being discovered a year later by a reconciliation
// alert nobody can clear.
test('every route that inserts a payment also writes a payment audit row', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routes = path.join(__dirname, '..', 'routes');

  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }).filter(file => file.endsWith('.js'));

  const silent = [];
  for (const file of [...walk(routes), path.join(__dirname, '..', 'lib', 'orderPaymentConfirmation.js')]) {
    const source = fs.readFileSync(file, 'utf8');
    if (!/INSERT INTO payments/.test(source)) continue;
    if (/logPaymentAudit/.test(source)) continue;
    silent.push(path.relative(path.join(__dirname, '..'), file).split(path.sep).join('/'));
  }
  assert.deepEqual(silent, [], 'these create payments that can never be traced to who made them');
});
