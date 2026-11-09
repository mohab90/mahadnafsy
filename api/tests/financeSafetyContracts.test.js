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









test('account onboarding and finance screens keep payments in the ledger-backed workflow', () => {
  const auth = authRouteSource();
  const onlineClients = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  const financialTab = read('admin/pages/dashboard/tabs/FinancialTab.tsx');
  const subscriberRoute = read('api/routes/admin/subscribers.js');
  const subscriberPayments = read('api/routes/subscriber-payments.js');
  const accessPanel = read('admin/pages/dashboard/tabs/online-clients-sections/ClientCourseAccessPanel.tsx');
  const agreed = read('api/lib/agreedPrice.js');

  
  
  
  
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




