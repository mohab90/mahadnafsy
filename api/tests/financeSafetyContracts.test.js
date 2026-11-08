'use strict';

const { authRouteSource, financeRouteSource } = require('./_authRouteSource');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');



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



test('payment links fail closed without configuration, redeem once, and installment reads enforce scope', () => {
  const finance = financeRouteSource();
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
  // The labels are the settings' list (الإعدادات › فئات المصاريف), read per tenant.
  assert.ok(financeRouteSource().includes('expenseCategoryLabel(s.category, categories)'));
  assert.match(route, /expenseCategory\(e2\.category, await loadExpenseCategories\(tenantId\)\)/);
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
  // An emptied ledger has to read as empty: neither the load nor the poll may
  // skip an empty answer. The load is on demand since 11 Oct 2026 (siteLists.ts).
  assert.match(runtime, /if \(expensesRes\.status === 'fulfilled' && expensesRes\.value\) setExpenses/);
  assert.match(runtime, /const rows = await \(permitted\('view_financial'\) \? mysqlAdmin\.listAllExpenses\(\) : refused\('view_financial'\)\);\n\s+setExpenses\(rows/);
});



test('account onboarding and finance screens keep payments in the ledger-backed workflow', () => {
  const auth = authRouteSource();
  const onlineClients = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  const financialTab = read('admin/pages/dashboard/tabs/FinancialTab.tsx');
  const subscriberRoute = read('api/routes/admin/subscribers.js');
  const subscriberPayments = read('api/routes/subscriber-payments.js');
  const accessPanel = read('admin/pages/dashboard/tabs/online-clients-sections/ClientCourseAccessPanel.tsx');
  const agreed = read('api/lib/agreedPrice.js');

  assert.match(auth, /firstPaymentStatus = canApproveFinancial \? 'paid' : 'pending'/);
  assert.match(auth, /paymentBundleId/);
  assert.match(auth, /if \(firstPaymentStatus === 'paid'\)[\s\S]{0,250}postPaymentJournal/);
  assert.match(onlineClients, /firstPayment:[\s\S]{0,1000}courseExpected/);
  // The Daqqi-branch half of this screen used to post the payment itself. It
  // calls the shared helper now — the one the Daqqi desk also calls — so a
  // booking taken at either place reaches the ledger the same way.
  assert.match(onlineClients, /createClientWithPayment\(draft, \{ branch/);
  const newClientHelper = read('admin/lib/createClientWithPayment.ts');
  assert.match(newClientHelper, /adminPost<[\s\S]{0,300}\/admin\/subscriber-payments/);
  const daqqiDesk = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.match(daqqiDesk, /createClientWithPayment\(draft, \{ branch/);
  // It used to build a paymentHistory array and hand it to saveSubscriber,
  // which writes the money onto the subscriber row and nowhere else — no
  // payments row, no journal line, no approval step.
  assert.doesNotMatch(daqqiDesk, /newSub\.paymentHistory = \[entry\]/);
  assert.doesNotMatch(onlineClients, /تم إنشاء العميل لكن الدفعة لم تُسجل/);
  assert.match(subscriberPayments, /if \(createFromDraft\)[\s\S]{0,2200}INSERT INTO subscribers/);
  assert.match(subscriberPayments, /await conn\.commit\(\)/);
  assert.match(financialTab, /mysqlAdmin\.getFinancialPnl/);
  assert.match(financialTab, /ledgerAllPnl\?\.totalRevenue/);
  assert.ok(read('api/routes/finance-payments-register.js').includes('revenue-breakdown'), 'the revenue split is the server\'s, from the ledger\'s paid payments');
  assert.match(subscriberRoute, /delete crmData\.paymentHistory/);
  // The panel that edits a client's price shows what the system recorded as
  // paid with no input for it: that moves only through a payment. What was
  // paid before the system is its own figure, on the client, never a payment.
  assert.match(accessPanel, /مدفوع في السيستم\s+<div className="mt-1 text-sm font-bold text-emerald-700">\{num\(head\.paid\)\}<\/div>/);
  assert.doesNotMatch(agreed.slice(agreed.indexOf('async function setPriorPaid')), /INSERT INTO payments/);
});




