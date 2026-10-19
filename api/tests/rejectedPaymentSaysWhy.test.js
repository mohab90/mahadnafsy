'use strict';

// «لما المحاسب يرفض دفعة لازم نسأله عن السبب ويروح اتوماتيك اشعار للسيلز او
// التحصيل يتقاله الدفعة اترفضت ليه» (13 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hasReason, reasonOf, recipientsOf, notifyPaymentRejected, REASON_REQUIRED } = require('../lib/paymentRejection');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

test('a reason is trimmed, bounded, and needs three letters to count', () => {
  assert.equal(reasonOf('  التحويل   مش وصل  '), 'التحويل مش وصل');
  assert.equal(reasonOf('', undefined, 'المبلغ غلط'), 'المبلغ غلط', 'the first candidate with text wins');
  assert.equal(reasonOf('x'.repeat(900)).length, 500);
  assert.equal(hasReason(''), false);
  assert.equal(hasReason('لا'), false);
  assert.equal(hasReason('لا يصلح'), true);
  assert.equal(REASON_REQUIRED.status, 400);
  assert.equal(REASON_REQUIRED.body.code, 'REJECT_REASON_REQUIRED');
});

test('the people behind a payment are told once each, and the one who rejected it is not', () => {
  assert.deepEqual(
    recipientsOf({ recordedBy: 'rep1', assignedSalesId: 'rep1', assignedCsId: 'cs1', rejectedBy: 'acc1' }),
    ['rep1', 'cs1']);
  assert.deepEqual(recipientsOf({ recordedBy: 'acc1', assignedSalesId: null, assignedCsId: '', rejectedBy: 'acc1' }), []);
  assert.deepEqual(recipientsOf({}), []);
});

test('each recipient gets a MESSAGE with the client, the amount, who rejected it and the reason — not a notification', async () => {
  const sent = [];
  const bell = [];
  const count = await notifyPaymentRejected({
    tenantId: 't1', reason: 'التحويل مش وصل', amount: 1500, currency: 'EGP', clientName: 'أحمد علي', clientCode: 'C77',
    subscriberId: 's1', recordedBy: 'rep1', assignedCsId: 'cs1', rejectedBy: 'acc1', rejectedByName: 'سارة المحاسبة',
  }, { notify: async (...args) => { bell.push(args); }, message: async input => { sent.push(input); } });
  assert.equal(count, 2);
  assert.deepEqual(bell, [], '«خليها في رسالة مش اشعار»: nothing goes to the bell when people are named');
  assert.deepEqual(sent.map(input => input.staffId), ['rep1', 'cs1'], 'addressed to each of them');
  const [first] = sent;
  assert.equal(first.tenantId, 't1');
  assert.equal(first.authorId, 'acc1');
  assert.equal(first.authorName, 'سارة المحاسبة');
  assert.match(first.body, /دفعة اترفضت/);
  assert.match(first.body, /أحمد علي/);
  assert.match(first.body, /C77/);
  assert.match(first.body, /1,500 EGP/);
  assert.match(first.body, /رفضها سارة المحاسبة/);
  assert.match(first.body, /السبب: التحويل مش وصل/);
});

test('with nobody to tell by name the managers\' bell hears it, and a failing message never undoes the rejection', async () => {
  const sent = [];
  await notifyPaymentRejected({ tenantId: 't1', reason: 'سبب واضح', rejectedBy: 'acc1' }, { notify: async (...args) => { sent.push(args); }, message: async () => { throw new Error('unused'); } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][5], null, 'no recipient = the managers');
  const outcome = await notifyPaymentRejected({ tenantId: 't1', reason: 'سبب واضح', recordedBy: 'rep1' }, { message: async () => { throw new Error('db down'); } });
  assert.equal(outcome, 0);
});

test('the message is written to the staff inbox, addressed to one employee', async () => {
  const { sendStaffMessage } = require('../lib/staffMessages');
  const calls = [];
  const id = await sendStaffMessage({ query: async (sql, params) => { calls.push({ sql, params }); } }, { tenantId: 't1', staffId: 'rep1', authorId: 'acc1', authorName: 'سارة', body: ' نص ' });
  assert.ok(id);
  assert.match(calls[0].sql, /INSERT INTO staff_messages/);
  assert.match(calls[0].sql, /'to_staff'/);
  assert.deepEqual(calls[0].params.slice(1), ['t1', 'rep1', 'acc1', 'سارة', 'نص']);
  await assert.rejects(() => sendStaffMessage({ query: async () => {} }, { tenantId: 't1', staffId: '', body: 'x' }));
});

test('a rejected new-client booking is also a message to the officer who sent it', () => {
  const route = read('api/routes/subscriber-payments.js');
  const reject = route.slice(route.indexOf("'/api/admin/subscriber-requests/:id/reject'"), route.indexOf('router.recordSubscriberPayment'));
  assert.match(reject, /sendStaffMessage\(pool/);
  assert.doesNotMatch(reject, /createNotification\(/, 'no bell notification');
});

test('customer service and the Dokki desk — and no one else — book and open any client', () => {
  const { canBookAnyClient, OPEN_ROLES } = require('../lib/bookingAccess');
  assert.deepEqual([...OPEN_ROLES].sort(), ['daqqi_manager', 'reception_daqqi', 'support']);
  for (const role of OPEN_ROLES) assert.equal(canBookAnyClient({ staffRecord: { role } }), true, role);
  assert.equal(canBookAnyClient({ staffRecord: { role: 'Support' } }), true, 'the role is compared case-insensitively');
  assert.equal(canBookAnyClient({ isSuperAdmin: true }), true);
  for (const role of ['sales', 'collection', 'online_manager', 'accountant', 'hr', 'reception_tagamoa', '', undefined]) {
    assert.equal(canBookAnyClient({ staffRecord: { role } }), false, String(role));
  }
  assert.equal(canBookAnyClient({}), false);
  // …and it is the one rule the three doors use: the booking, the search and the file.
  assert.match(read('api/routes/subscriber-payments.js'), /const bookAny = canBookAnyClient\(req\);/);
  assert.match(read('api/routes/subscriber-payments.js'), /!createFromDraft && !bookAny && !financialRecordMatches\(scope, subRow\)/);
  assert.match(read('api/routes/subscriber-payments.js'), /bookAny \? \{ none: false, sql: '', params: \[\] \} : leadScope\(req, 'l'\)/);
  assert.match(read('api/routes/misc/clientDbSearch.js'), /canBookAnyClient\(req\)\) \? true : Number\(l\.can_open\) === 1/);
  assert.match(read('api/routes/admin/subscribers.js'), /=== 'all' \|\| canBookAnyClient\(req\)/);
});

test('all three roads that reject money ask for the reason and tell the people behind it', () => {
  const payments = read('api/routes/core/financepay.js');
  assert.match(payments, /status === 'failed' \? reasonOf\(reviewNote, req\.body\?\.reason\)/);
  assert.match(payments, /if \(status === 'failed' && !hasReason\(rejectionReason\)\) return res\.status\(REASON_REQUIRED\.status\)/);
  assert.match(payments, /await notifyPaymentRejected\(\{/);
  assert.match(payments, /Review: /, 'the reason stays on the payment');

  const proofs = read('api/routes/payment-proofs.js');
  assert.match(proofs, /action === 'reject' \? reasonOf\(reviewer_note\)/);
  assert.match(proofs, /action === 'reject' && !hasReason\(rejectionReason\)/);
  assert.match(proofs, /kind: 'payment_proof'/);

  const orders = read('api/routes/orders.js');
  assert.match(orders, /newStatus === 'failed' \? reasonOf\(req\.body\.reason, req\.body\.reviewNote\)/);
  assert.match(orders, /kind: 'order'/);
});

test('every reject button asks the question first, and none rejects with a canned reason', () => {
  for (const file of [
    'admin/pages/dashboard/tabs/orders/useOrderActions.ts',
    'admin/pages/dashboard/tabs/orders/OrdersOnlineManagerView.tsx',
    'admin/pages/dashboard/tabs/orders/CollectionBookingsReview.tsx',
    'admin/pages/dashboard/tabs/financial/usePaymentProofsReview.ts',
    'admin/pages/unified-client/useUnifiedClientPaymentProofs.ts',
  ]) {
    assert.match(read(file), /askRejectionReason\(/, file);
  }
  assert.doesNotMatch(read('admin/pages/dashboard/tabs/orders/CollectionBookingsReview.tsx'), /reviewNote: 'رفض المسئول'/);
  // …and every call that rejects a payment passes it on.
  assert.match(read('admin/pages/dashboard/tabs/orders/useOrderActions.ts'), /updatePaymentStatus\(row\.id, 'failed', reason\)/);
  assert.match(read('admin/pages/dashboard/tabs/orders/OrdersOnlineManagerView.tsx'), /updatePaymentStatus\(payId, 'failed', reason\)/);
  assert.match(read('admin/lib/mysqlapi.ts'), /updateOrderStatus: \(id: string, status: string, reason\?: string\)/);
});
