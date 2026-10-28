'use strict';
/**
 * «السيلز أو التحصيل بيعمل حجز أو دفع من صفحة العميل ويكتب رقم العملية ومش بيظهر في المدفوعات» (18 Oct 2026).
 *
 * Reproduced against the real API on a production-scale lab: the server stores a payment recorded by a sales rep
 * or a collection officer as «pending» until a manager approves it (api/routes/subscriber-payments.js — recording
 * and approving money are separate duties), and returns it, with its transaction number, on the client page. The
 * page's «سجل المعاملات» was built from the confirmed payments alone: the tab said three, the log showed two.
 *
 * Found on the way: every non-admin role re-downloaded all of its leads and all of its clients on every trigger,
 * with nothing stopping the downloads overlapping (a sales rep's «مدفوعاتي» sent 1,156 requests).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');

// A reference already used is refused by name (and never with another
// institute's client's name): tests/integration/deskPaymentsAndOrders.integration.test.js.

test('the client page lists every recorded payment, marks the ones awaiting approval, and shows the transaction number', () => {
  const panel = read('admin/pages/unified-client/UnifiedClientSubscriberPaymentsPanel.tsx');
  const log = panel.slice(panel.indexOf('Transaction History'), panel.indexOf('Payment Proofs'));
  assert.ok(log.includes('subHistory.length > 0'), 'the log is built from everything recorded');
  assert.ok(log.includes('[...subHistory].sort('));
  assert.ok(!/confirmedHistory/.test(log), 'not from the confirmed subset');
  assert.ok(log.includes("بانتظار الاعتماد"));
  assert.ok(log.includes('رقم العملية: #{p.transactionId}'), 'the number the rep typed is labelled');
  assert.ok(panel.includes("pending: { label: '⏳ بانتظار الاعتماد'"));
  assert.ok(log.includes('isConfirmed(p) && <button'), 'a receipt is printed only for confirmed money');
  assert.ok(panel.includes('subHistory.length === 0 && !showSubPayForm'), 'the empty state follows the same list');
  // The totals keep counting confirmed money only.
  const hook = read('admin/pages/unified-client/useUnifiedClientPayments.ts');
  assert.ok(hook.includes("const confirmedHistory = subHistory.filter(payment => !payment.status || payment.status === 'paid');"));
});

test('a staff member\'s own lists are refreshed one at a time, and the timer and tab focus ask only when they are stale', () => {
  const own = read('admin/pages/dashboard/useStaffOwnData.ts');
  assert.ok(own.includes('const loadSalesData = useCallback(async () => {'));
  assert.ok(own.includes('if (runningRef.current) { queuedRef.current = true; return runningRef.current; }'), 'a call during a run joins it');
  assert.ok(own.includes('if (queuedRef.current) { queuedRef.current = false; runningRef.current = run(); }'), 'and asks for exactly one more');
  assert.ok(own.includes('fetchSalesDataIfStale'));
  const dashboard = dashboardSource();
  assert.ok(dashboard.includes('void fetchSalesDataIfStale(110 * 1000)'), 'the timer');
  assert.ok(dashboard.includes('void fetchSalesDataIfStale(2 * 60 * 1000)'), 'the return to the tab');
  assert.ok(!/visibilityState === 'visible'\) void fetchSalesData\(\)/.test(dashboard), 'a return to the tab is not a full download');
});

test('the transaction number typed in the payment dialog is sent as the payment\'s transaction number, not folded into its note', () => {
  // payments.transaction_id is UNIQUE, so only the main payment of a save carries it.
  const page = read('admin/pages/unified-client/useUnifiedClientPayments.ts');
  const entry = page.slice(page.indexOf('const entry: PaymentHistoryEntry = {'), page.indexOf('// The branch tier and the client'));
  assert.ok(entry.includes('transactionId: draft.transactionId || undefined,'));
  assert.ok(!/draft\.transactionId \|\| undefined,\n\s*bundle \?/.test(entry), 'it is no longer joined into the note');
  assert.ok(page.includes("draft.transactionId ? `رقم العملية: ${draft.transactionId}` : undefined"), 'the added rows name it in their notes');

  const handler = read('admin/pages/dashboard/dashboardPaymentHandlers.ts');
  assert.ok(handler.includes('const txnFields = { transactionId: subPayDraft.transactionId || undefined, fromAccountNumber: subPayDraft.transferRef || undefined, senderName: subPayDraft.senderName || undefined };'));
  assert.ok(!/const noteParts = \[subPayDraft\.note, subPayDraft\.transactionId/.test(handler), 'the number and the transferring account are not note text');
  assert.ok(handler.includes('...(itemIndex === 0 ? txnFields : { fromAccountNumber: txnFields.fromAccountNumber, senderName: txnFields.senderName }),'), 'the first of several courses carries it');
  assert.ok(handler.includes('...txnFields,'), 'a single payment carries it');
});

test('the Dokki desk and the finance tab also send the transaction number as a field', () => {
  const dokki = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.ok(dokki.includes('transactionId: daqqiPayDraft.transactionId || undefined,'));
  assert.ok(!/note: \[daqqiPayDraft\.note, daqqiPayDraft\.transactionId/.test(dokki));
  const finance = read('admin/pages/dashboard/tabs/FinancialTab.tsx');
  assert.ok(finance.includes('transactionId: draft.transactionId || undefined,'));
  assert.ok(!/note: \[draft\.note, draft\.transactionId\]/.test(finance));
});
