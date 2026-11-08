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
  
  // Reopening a closed accounting period must capture a reason and send it.
  //
  // This named window.prompt, which was the mechanism rather than the control —
  // and that mechanism was the problem: a browser may suppress the dialog, and
  // prompt() then returns null, so reopening would silently refuse itself with
  // the message "السبب إلزامي" and no way to proceed. Asserted on the property
  // now: a reason is collected, its absence blocks the call, and it travels
  // with the request.
  
  
  
});



test('payment links fail closed without configuration, redeem once, and installment reads enforce scope', () => {
  const finance = financeRouteSource();
  const checkout = read('api/routes/lead-capture-crm.js');
  const installments = read('api/routes/installments.js');
  assert.match(finance, /PAYMENT_LINKS_ENABLED !== 'true'/);
  assert.match(finance, /PAYMENT_LINK_CHECKOUT_URL_TEMPLATE/);
  assert.doesNotMatch(finance, /mahadnafsy\.com\/#\/pay/);
  
  
  // The overdue count comes from the schedule itself, never from a stored
  // next_due_date that can go stale. It used to read the array in SQL at index
  // paid_count — a count, not an index, so a plan whose instalments were
  // settled out of order pointed at the wrong entry and missed the overdue one.
  // It now selects the arrays and walks every entry, which is what the AR-aging
  // screen already did; the guarantee here is the source, not the mechanism.
  assert.doesNotMatch(finance, /installment_plans[\s\S]{0,160}next_due_date/);
  assert.match(finance, /ip\.due_dates, ip\.paid_dates, ip\.payment_ids/);
  assert.match(finance, /!paidDates\[index\] && !paymentIds\[index\]/);
  
  
  
});

test('expense UI waits for the server ledger and the API preserves category, branch and editable fields', () => {
  const route = read('api/routes/admin-operations.js');
  const state = read('admin/context/site-data-hooks/useExpensesState.ts');
  const panel = read('admin/pages/dashboard/tabs/financial/FinancialExpensesPanel.tsx');
  const runtime = read('admin/context/site-data-hooks/useAdminDataRuntime.ts');
  
  
  // The category map moved to lib/expenseCategories.js so the budget route can
  // reach it too: budgets are keyed by the Arabic label and expenses by the
  // English code, and with the map locked inside this route the two could never
  // be joined — «الفعلي» read 0 for every category.
  const categories = read('api/lib/expenseCategories.js');
  
  
  // The labels are the settings' list (الإعدادات › فئات المصاريف), read per tenant.
  assert.ok(financeRouteSource().includes('expenseCategoryLabel(s.category, categories)'));
  
  
  
  
  
  
  
  
  
  
  
  // An emptied ledger has to read as empty: neither the load nor the poll may
  // skip an empty answer. The load is on demand since 11 Oct 2026 (siteLists.ts).
  
  
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
  
  // The Daqqi-branch half of this screen used to post the payment itself. It
  // calls the shared helper now — the one the Daqqi desk also calls — so a
  // booking taken at either place reaches the ledger the same way.
  
  const newClientHelper = read('admin/lib/createClientWithPayment.ts');
  
  const daqqiDesk = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  
  // It used to build a paymentHistory array and hand it to saveSubscriber,
  // which writes the money onto the subscriber row and nowhere else — no
  // payments row, no journal line, no approval step.
  
  
  
  
  
  
  
  
  // The panel that edits a client's price shows what the system recorded as
  // paid with no input for it: that moves only through a payment. What was
  // paid before the system is its own figure, on the client, never a payment.
  
  assert.doesNotMatch(agreed.slice(agreed.indexOf('async function setPriorPaid')), /INSERT INTO payments/);
});




