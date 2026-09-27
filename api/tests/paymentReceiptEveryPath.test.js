'use strict';
// «أي دفعة: إيميل للعميل بالمبلغ اللي اتدفع وإن جزء جديد من الكورس اتفتح».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');

const lifecycle = require('../lib/lifecycle');
const { queuePaymentReceipt } = require('../lib/paymentReceipt');

function fakeDb(payment) {
  return { async query(sql) {
    if (/FROM payments p\s+JOIN subscribers/.test(sql)) return [[payment]];
    if (/FROM bundle_courses/.test(sql)) return [[{ course_id: 'c-1' }, { course_id: 'c-2' }]];
    if (/FROM courses c/.test(sql)) {
      return [[
        { id: 'c-1', title: 'الكورس الأول', access_type: 'limited', lecture_limit: 4, status: 'active', total: 12 },
        { id: 'c-2', title: 'الكورس التاني', access_type: 'full', lecture_limit: null, status: 'active', total: 8 },
      ]];
    }
    if (/MAX\(course_expected\) AS expected, SUM\(amount\) AS paid/.test(sql)) return [[{ expected: 9000, paid: 3000 }]];
    return [[]];
  } };
}

test('the receipt says what was paid, what it opened, and what is left — once per payment', async t => {
  const calls = [];
  t.mock.method(lifecycle, 'trigger', async (...args) => { calls.push(args); });
  const payment = { id: 'pay-1', subscriber_id: 's1', course_id: null, bundle_id: 'b-1', amount: 3000, currency: 'EGP',
    status: 'paid', payment_method: 'فودافون كاش', day: '2026-09-28', name: 'عميل', email: 'a@example.test', title: 'مسار' };
  assert.equal(await queuePaymentReceipt('t', 'pay-1', fakeDb(payment)), true);
  const [event, ctx, opts] = calls[0];
  assert.equal(event, 'payment_received');
  assert.deepEqual(ctx.unlocked, [
    { title: 'الكورس الأول', full: false, total: 12, open: 4 },
    { title: 'الكورس التاني', full: true, total: 8, open: 8 },
  ]);
  assert.equal(ctx.remaining, 6000);
  assert.equal(ctx.date, '2026-09-28');
  assert.deepEqual(opts, { channels: ['email'], dedupeKey: 'payment:pay-1' });

  // Nothing for a payment that is not paid yet, or a client with no address.
  assert.equal(await queuePaymentReceipt('t', 'pay-1', fakeDb({ ...payment, status: 'pending' })), false);
  assert.equal(await queuePaymentReceipt('t', 'pay-1', fakeDb({ ...payment, email: '' })), false);
  assert.equal(calls.length, 1);
});

test('the template lists what was opened', () => {
  const source = read('lib/lifecycle.js');
  assert.match(source, /مفتوح لك \$\{u\.open\} من \$\{u\.total\} محاضرة/);
  assert.match(source, /<tr><td>المتبقي<\/td>/);
});

test('every path that makes a payment paid queues it, and none writes its own', () => {
  const paths = {
    'routes/subscriber-payments.js': /queuePaymentReceipt\(paymentTenantId, id\);/,
    'routes/core/financepay.js': /queuePaymentReceipt\(tenantId, id\);/,
    'routes/payment-proofs.js': /queuePaymentReceipt\(req\.tenantId, `proof-\$\{proof\.id\}`\);/,
    'routes/orders.js': /queuePaymentReceipt\(req\.tenantId, paymentId\);/,
    'routes/public-orders.js': /queuePaymentReceipt\(tenantId, payId\);/,
    'routes/installments.js': /queuePaymentReceipt\(req\.tenantId, payId\);/,
    'routes/auth.js': /if \(firstPaymentId\) queuePaymentReceipt\(tenantId, firstPaymentId\);/,
  };
  for (const [rel, pattern] of Object.entries(paths)) assert.match(read(rel), pattern, rel);
  assert.doesNotMatch(read('routes/subscriber-payments.js'), /إيصال الدفع — معهد الدراسات النفسية/);
  assert.doesNotMatch(read('routes/public-orders.js'), /✅ تم استلام دفعتك — /);
});

test('paying an instalment opens lectures like every other payment', () => {
  const source = read('routes/installments.js');
  assert.match(source, /await grantCourseEntitlement\(\{/);
  assert.match(source, /paidRatio: paidRatioOf\(access\)/);
});
