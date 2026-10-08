'use strict';

// «مسئول تحصيل حاول يعمل اشتراك كارنيه لعميل ظهر رساله بتقول المبلغ اكبر من
// المتبقي ؟ وكانه لسه بيزود الفلوس علي فلوس الكورس» (8 Oct 2026). A carnet or a
// book names «الكورس المرتبط»; it is not that course's money: it does not count
// toward the course, join its instalments, take its price, or open it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

test('only course, track and old «other» money is a course\'s', () => {
  const { isItemPaymentType } = require('../lib/agreedPrice');
  for (const type of ['COURSE', 'BUNDLE', 'OTHER', 'course', null]) assert.equal(isItemPaymentType(type), true, String(type));
  for (const type of ['CARNEH', 'BOOK', 'CERTIFICATE', 'CONSULTATION', 'carneh']) assert.equal(isItemPaymentType(type), false, type);
});

test('the course\'s instalments sum only its own money', async () => {
  const seen = [];
  const { resolvePaymentAccess } = require('../lib/paymentEntitlementAccess');
  const db = { query: async sql => { seen.push(String(sql)); return [[{ currency: 'EGP', total_paid: 1000, min_expected: 3400, max_expected: 3400 }]]; } };
  await resolvePaymentAccess({ db, tenantId: 't', subscriberId: 's', courseId: 'c', bundleId: null, currentPaymentId: 'p', currentAmount: 500, currency: 'EGP', expectedAmount: 3400 });
  assert.match(seen[0], /payment_type IN \('COURSE','BUNDLE','OTHER'\)/);
});

test('a paid carnet neither takes the course\'s price nor opens it', () => {
  const route = read('api/routes/subscriber-payments.js');
  assert.match(route, /const paysForItem = isItemPaymentType\(safeType\);/);
  assert.match(route, /if \(priceTier && paysForItem && \(courseId \|\| bundleId\)\)/);
  assert.match(route, /if \(resolvedExpected == null && paysForItem && \(courseId \|\| bundleId\)\)/);
  assert.match(route, /if \(isPaid && paysForItem && \(courseId \|\| bundleId\)\) \{\s*let enrollAccessType = 'full';/);
  const approval = read('api/routes/core/financepay.js');
  assert.match(approval, /const opensItem = isItemPaymentType\(payment\.payment_type\);\s*if \(opensItem && payment\.course_id\)/);
});

test('the desk is asked «أكبر من المتبقي» only for the course\'s own money', () => {
  assert.match(read('admin/components/PaymentModal.tsx'), /const left = d\.paymentType === 'course' && chosen && _effPx > 0/);
});
