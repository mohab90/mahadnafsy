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

test('each recipient gets the client, the amount, who rejected it and the reason', async () => {
  const sent = [];
  const count = await notifyPaymentRejected({
    tenantId: 't1', reason: 'التحويل مش وصل', amount: 1500, currency: 'EGP', clientName: 'أحمد علي', clientCode: 'C77',
    subscriberId: 's1', recordedBy: 'rep1', assignedCsId: 'cs1', rejectedBy: 'acc1', rejectedByName: 'سارة المحاسبة',
  }, { notify: async (...args) => { sent.push(args); } });
  assert.equal(count, 2);
  assert.deepEqual(sent.map(args => args[5]), ['rep1', 'cs1'], 'addressed to each of them');
  const [type, title, message, data, tenantId] = sent[0];
  assert.equal(type, 'payment');
  assert.match(title, /دفعة اترفضت/);
  assert.match(message, /أحمد علي/);
  assert.match(message, /1,500 EGP/);
  assert.match(message, /سارة المحاسبة/);
  assert.match(message, /السبب: التحويل مش وصل/);
  assert.equal(data.reason, 'التحويل مش وصل');
  assert.equal(data.clientCode, 'C77');
  assert.equal(tenantId, 't1');
});

test('with nobody to tell by name the managers hear it, and a failing notification never undoes the rejection', async () => {
  const sent = [];
  await notifyPaymentRejected({ tenantId: 't1', reason: 'سبب واضح', rejectedBy: 'acc1' }, { notify: async (...args) => { sent.push(args); } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][5], null, 'no recipient = the managers');
  const outcome = await notifyPaymentRejected({ tenantId: 't1', reason: 'سبب واضح', recordedBy: 'rep1' }, { notify: async () => { throw new Error('db down'); } });
  assert.equal(outcome, 0);
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
