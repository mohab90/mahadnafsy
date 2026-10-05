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
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function load(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

const { mustLinkTransfer, TRANSFER_REQUIRED } = require('../lib/paymentApprovalPolicy');
const asRole = role => ({ staffRecord: { role }, isSuperAdmin: false });

test('the manager and the admin accept outright; everyone else links a transfer, cash excepted', () => {
  for (const role of ['manager', 'admin', 'MANAGER']) {
    assert.equal(mustLinkTransfer(asRole(role), 'فودافون كاش 2020'), false, `${role} accepts directly`);
  }
  assert.equal(mustLinkTransfer({ staffRecord: { role: 'sales' }, isSuperAdmin: true }, 'تحويل بنكي'), false, 'the super admin too');
  for (const role of ['accountant', 'daqqi_manager', 'online_manager', 'sales_collection_manager', 'support']) {
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
  assert.match(payments, /require\('\.\.\/\.\.\/lib\/paymentApprovalPolicy'\)/);
  const block = payments.slice(payments.indexOf('if (!transfer && mustLinkTransfer(req, settledMethod))'));
  assert.match(block.slice(0, 260), /rollback\(\)[\s\S]*TRANSFER_REQUIRED/);
  const orders = read('api/routes/orders.js');
  const confirm = orders.slice(orders.indexOf("router.post('/api/admin/orders/:id/confirm-payment'"));
  assert.match(confirm, /if \(!linkedTransferId && mustLinkTransfer\(req, order\.payment_method\)\)/);
  // The refusal comes before the money moves.
  assert.ok(confirm.indexOf('mustLinkTransfer') < confirm.indexOf('confirmOrderPayment({'));
});

test('a desk payment is approved, rejected and linked through the payments route, with the server\'s reason shown', () => {
  const tab = ordersScreenSource();
  assert.match(tab, /const isDeskPayment = \(row: OrderItem\) => row\.source === 'crm';/);
  assert.match(tab, /await mysqlAdmin\.updatePaymentStatus\(row\.id, 'paid', undefined, method\);/);
  assert.match(tab, /await mysqlAdmin\.updatePaymentStatus\(row\.id, 'failed'\);/);
  assert.match(tab, /updatePaymentStatus\(row\.id, 'paid', undefined, storedMethodOf\(row\) \|\| transfer\.method, \{ transferId: transfer\.id \}\)/);
  // The orders route stays for orders.
  assert.match(tab, /adminPost\(`\/admin\/orders\/\$\{row\.id\}\/confirm-payment`, \{\}\)/);
  // No more swallowing the reason behind a guess.
  assert.doesNotMatch(tab, /notify\('error', '[^']*تحقق من أن الطلب/);
  assert.match(tab, /notify\('error', messageOf\(error, 'تعذر تأكيد الدفعة\.'\)\)/);
  // Accept is the manager's button; link is everyone's.
  assert.match(tab, /const canAcceptDirectly = isAdmin \|\| approverRole === 'manager';/);
  assert.match(tab, /\{canAcceptDirectly && \(\s*<button onClick=\{\(\) => handleConfirmOrder\(row\)\}/);
  assert.match(tab, /🔗 ربط/);
});

test('the review list names the course or track and the branch', () => {
  const tab = ordersScreenSource();
  assert.match(tab, /الفرع<\/th>\s*<th[^>]*>الدفعة خاصة بإيه<\/th>/);
  assert.match(tab, /const forTitle = heldBundle \? `📌 \$\{heldBundle\.title\}` : \(heldCourse\?\.titleAr \|\| heldCourse\?\.title \|\| productTitle\);/);
  assert.match(tab, /row\.isInstallment && <span[^>]*>قسط<\/span>/);
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

test('the clients screen reads the context\'s rounds and clients, not the copies that only change on the next poll', () => {
  const dashboard = read('admin/pages/Dashboard.tsx');
  assert.match(dashboard, /salesOwnDaqqiRounds: siteDaqqiRounds,/);
  assert.doesNotMatch(dashboard, /salesOwnDaqqiRounds: salesOwnDaqqiRounds \?\? \[\],/);
  assert.match(dashboard, /setStaffScopedRounds: bulkSetDaqqiRounds,/);
  const own = read('admin/pages/dashboard/useStaffOwnData.ts');
  assert.match(own, /setStaffScopedRounds\?\.\(parsedRounds\);/);
  const growth = read('admin/pages/dashboard/DashboardGrowthOpsTabs.tsx');
  assert.doesNotMatch(growth, /roundsOverride=\{isNonAdminStaff/);
  const clients = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  assert.match(clients, /salesOwnSubscribers\.map\(row => fresh\.get\(row\.id\) \?\? row\)/);
});

test('the Dokki clients table has no branch column, the online one keeps its market column', () => {
  const table = read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx');
  assert.equal((table.match(/\{vc\.branch && !isDaqqiClientsTab && /g) || []).length, 3, 'header and both cell variants');
  assert.doesNotMatch(table, /\{vc\.branch && </);
});

test('a client booked into a Dokki round becomes a Dokki client, in the booking\'s own transaction', () => {
  const route = read('api/routes/daqqi-rounds.js');
  assert.match(route, /const \{ branchIdForBranch \} = require\('\.\.\/lib\/branches'\);/);
  const booked = route.slice(route.indexOf('if (!alreadyBooked) {'));
  assert.match(booked.slice(0, 500), /UPDATE subscribers SET branch='DAQQI', branch_id=\?/);
  assert.match(booked.slice(0, 500), /AND \(branch IS NULL OR branch<>'DAQQI'\)/);
  // Before the commit.
  assert.ok(route.indexOf('if (!alreadyBooked) {') < route.indexOf("await writeAuditEvent({\n      action: existing ? 'DAQQI_ROUND_UPDATED'"));
});

test('after a payment the rounds are read back, not patched in the browser', () => {
  const tab = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.match(tab, /bulkSetDaqqiRounds\(await mysqlAdmin\.listAllDaqqiRounds\(\) as unknown as DaqqiRound\[\]\)/);
  assert.match(tab, /await refreshRounds\(\);/);
  assert.doesNotMatch(tab, /تعذر تحديث إجمالي العميل داخل الروند/);
});

test('the payment dialog sees a course held by money, a price, a prior payment or the round', () => {
  const modal = read('admin/components/PaymentModal.tsx');
  assert.match(modal, /heldItemIds\?: string\[\];/);
  assert.match(modal, /const enrolledIds: string\[\] = \[\.\.\.new Set\(\[\.\.\.\(subject\.enrolledCourseIds \|\| \[\]\), \.\.\.heldByMoney\]\)\];/);
  assert.match(modal, /\(Number\(subject\.priorPaid\?\.\[cid\]\) \|\| 0\) \+ payHistory\.filter/);
  assert.match(modal, /\(coursePayMap\[d\.courseId\]\?\.paid \?\? 0\) \+ \(Number\(subject\.priorPaid\?\.\[d\.courseId\]\) \|\| 0\)/);
  const dokki = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.match(dokki, /heldItemIds: \(\(\) => \{/);
  assert.match(dokki, /priorPaid: paySubject\?\.priorPaid,/);
  assert.match(read('admin/pages/dashboard/DashboardPaymentOverlays.tsx'), /priorPaid: subscriber\.priorPaid,/);
});
