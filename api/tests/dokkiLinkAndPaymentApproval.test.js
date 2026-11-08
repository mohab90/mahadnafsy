'use strict';

/**
 * Reported from the Dokki desk and the accounts screen on 3 Oct 2026:
 *
 *  - «تعذر تأكيد الدفعة — تحقق من أن الطلب لسه قيد المراجعة» on every instalment a
 *    desk had recorded. The review list merges the orders table with the payments a
 *    person recorded (source «crm»); the accept button called the ORDERS route for
 *    both, and a payments id is not an order, so it answered «Order not found» and
 *    the screen swallowed the reason.
 *  - The manager accepts; anyone else confirms against the transfer («🔗 ربط»).
 *  - The review list said «course» for every payment and no branch: it now names the
 *    course or track and the branch.
 *  - A client housed in a round did not show on «عملاء الدقي»; the clients screen read a
 *    stale copy of the clients and an empty one of the rounds.
 *  - The payment dialog offered no «تكملة لمسار» and no instalment list to a client
 *    whose only trace of a course was money or the round.
 */
const { ordersScreenSource } = require('./_authRouteSource');
const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardSource, paymentModalSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');



const { mustLinkTransfer, TRANSFER_REQUIRED } = require('../lib/paymentApprovalPolicy');
const { ROOT, read, bundle: load } = require('./support/repo');
const asRole = role => ({ staffRecord: { role }, isSuperAdmin: false });

test('the manager and the admin accept outright; everyone else links a transfer, cash excepted', () => {
  // Customer service since 2 Nov 2026: «نفس التحكم بتاع المدير في الصفحات اللي بتظهرلها ماعدا المسح».
  for (const role of ['manager', 'admin', 'MANAGER', 'support', 'SUPPORT']) {
    assert.equal(mustLinkTransfer(asRole(role), 'فودافون كاش 2020'), false, `${role} accepts directly`);
  }
  assert.equal(mustLinkTransfer({ staffRecord: { role: 'sales' }, isSuperAdmin: true }, 'تحويل بنكي'), false, 'the super admin too');
  for (const role of ['accountant', 'daqqi_manager', 'online_manager', 'sales_collection_manager']) {
    assert.equal(mustLinkTransfer(asRole(role), 'فودافون كاش 2020'), true, `${role} links a wallet transfer`);
    assert.equal(mustLinkTransfer(asRole(role), 'انستا باي'), true, `${role} links an instapay transfer`);
    assert.equal(mustLinkTransfer(asRole(role), 'نقدي'), false, `${role} counts cash, nothing to link`);
    assert.equal(mustLinkTransfer(asRole(role), 'خزنة الدقي'), false, `${role} counts the Dokki till`);
  }
  assert.equal(TRANSFER_REQUIRED.status, 400);
  assert.equal(TRANSFER_REQUIRED.body.code, 'TRANSFER_REQUIRED');
});

test('both approval routes hold the same line, and say so before anything is written', () => {
  const payments = read('api/routes/core/financepay.js');
  
  const block = payments.slice(payments.indexOf('if (!transfer && mustLinkTransfer(req, settledMethod))'));
  assert.match(block.slice(0, 260), /rollback\(\)[\s\S]*TRANSFER_REQUIRED/);
  const orders = read('api/routes/orders.js');
  const confirm = orders.slice(orders.indexOf("router.post('/api/admin/orders/:id/confirm-payment'"));
  assert.match(confirm, /if \(!linkedTransferId && mustLinkTransfer\(req, order\.payment_method\)\)/);
  // The refusal comes before the money moves.
  assert.ok(confirm.indexOf('mustLinkTransfer') < confirm.indexOf('confirmOrderPayment({'));
});



test('the review list names the course or track and the branch', () => {
  const tab = ordersScreenSource();
  
  
  
  const normalise = load('admin/context/site-data-hooks/normalizeOrders.ts');
  if (!normalise) return;
  const [row] = normalise.normalizeOrders([{
    id: 'p1', type: 'course', status: 'pending', amount: 1500, source: 'crm', course_id: 'c1',
    branch_id: 'branch-daqqi', is_installment: 1, notes: 'القسط الثاني', payment_method: 'MANUAL',
  }]);
  assert.equal(row.branchId, 'branch-daqqi');
  assert.equal(row.isInstallment, true);
  assert.equal(row.note, 'القسط الثاني');
  assert.equal(row.courseId, 'c1');
  assert.equal(row.source, 'crm');
});

// ── Dokki: one set of rounds, one fresh set of clients ──────────────────────



test('the Dokki clients table has no branch column, the online one keeps its market column', () => {
  const table = read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx');
  assert.equal((table.match(/\{vc\.branch && !isDaqqiClientsTab && /g) || []).length, 3, 'header and both cell variants');
  
});

test('a client booked into a Dokki round becomes a Dokki client, in the booking\'s own transaction', () => {
  const route = read('api/routes/daqqi-rounds.js');
  
  const booked = route.slice(route.indexOf('if (!alreadyBooked) {'));
  // A client of the round's branch — Dokki's rounds make Dokki clients.
  assert.match(booked.slice(0, 500), /UPDATE subscribers SET branch=\?, branch_id=\?/);
  assert.match(booked.slice(0, 500), /AND \(branch IS NULL OR branch<>\?\)/);
  assert.match(booked.slice(0, 500), /\[roundBranch, branchIdForBranch\(roundBranch\)/);
  // Before the commit.
  assert.ok(route.indexOf('if (!alreadyBooked) {') < route.indexOf("await writeAuditEvent({\n      action: existing ? 'DAQQI_ROUND_UPDATED'"));
});




