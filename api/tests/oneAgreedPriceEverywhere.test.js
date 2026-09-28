'use strict';
// «لما بنعدلها وقت تسجيل حجز العميل مش بتظهر في صفحه عملاء الاونلاين وبتظهر
// السعر الاجمالي علي السسيتم … حتي في شاشه تسجيل حجز ودفع واقساط بيكون فيها
// جزء صح وجزء السعر الاساسي».
//
// One client's price was read four ways: the online table (saved price, then
// catalogue), the instalment list and «كل المتبقي» (catalogue), the totals bar
// (bookings only), the access panel and the collections list (bookings only,
// and course rows only). An instalment recorded no price at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { itemBalances, resolveAgreed } = require('../lib/agreedPrice');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the rule: their own price, else the booking\'s (never under what was paid), else the catalogue', () => {
  assert.equal(resolveAgreed({ custom: 2800, booked: 3400, paid: 700, catalogue: 3400 }), 2800);
  assert.equal(resolveAgreed({ booked: 3000, paid: 700, catalogue: 3400 }), 3000);
  // The 21 track bookings that carry one course's price: 900 on a track paid 5,500.
  assert.equal(resolveAgreed({ booked: 900, paid: 5500, catalogue: 5600 }), 5500);
  assert.equal(resolveAgreed({ paid: 0, catalogue: 3400 }), 3400);
  assert.equal(resolveAgreed({}), null);
});

test('a client\'s balance counts their tracks, the currency they pay in, and what they paid before', async () => {
  const db = { async query(sql) {
    if (/SELECT crm_json FROM subscribers/.test(sql)) {
      return [[{ crm_json: JSON.stringify({ customPrices: { 'c-2': 2500 }, priorPaid: { 'bundle:b-1': 1000 } }) }]];
    }
    if (/FROM payments/.test(sql)) {
      return [[
        { course_id: null, bundle_id: 'b-1', amount: 900, currency: 'EGP', status: 'paid', course_expected: 900 },
        { course_id: null, bundle_id: 'b-1', amount: 4600, currency: 'EGP', status: 'paid', course_expected: null },
        { course_id: 'c-3', bundle_id: null, amount: 200, currency: 'SAR', status: 'paid', course_expected: 800 },
        { course_id: 'c-3', bundle_id: null, amount: 100, currency: 'SAR', status: 'refunded', course_expected: 800 },
      ]];
    }
    if (/FROM enrollments/.test(sql)) return [[{ course_id: 'c-2', bundle_id: null }]];
    if (/FROM `bundles`/.test(sql)) return [[{ price: 5600 }]];
    if (/FROM `courses`/.test(sql)) return [[{ price: 3000 }]];
    return [[]];
  } };
  const balances = await itemBalances(db, { tenantId: 't', subscriberId: 's' });
  const track = balances.get('bundle:b-1');
  assert.deepEqual([track.expected, track.paid, track.priorPaid, track.remaining], [5500, 5500, 1000, 0]);
  const saudi = balances.get('c-3');
  assert.deepEqual([saudi.currency, saudi.expected, saudi.paid, saudi.remaining], ['SAR', 800, 200, 600]);
  // Enrolled with no payment yet: their own price, owed in full.
  assert.deepEqual([balances.get('c-2').expected, balances.get('c-2').remaining], [2500, 2500]);
});

test('every screen reads that rule', () => {
  const admin = read('admin/lib/agreedPrice.ts');
  assert.match(admin, /if \(booked > 0\) return Math\.max\(booked, paidFor\(subscriber, item, currency\)\);/);
  // The table, the plans window and the plans page list the same items.
  const table = read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx');
  assert.match(table, /const courseRows = clientItems\(row, courses, bundles, branchCurrency\)/);
  assert.doesNotMatch(table, /multiCourseKey|completeBundles/);
  assert.match(read('admin/pages/dashboard/tabs/online-clients-sections/InstallmentPlansModal.tsx'),
    /const items = useMemo\(\(\) => clientItems\(subscriber, courses, bundles, defaultCurrency\)/);
  assert.match(read('admin/pages/dashboard/tabs/InstallmentPlansTab.tsx'), /clientItems\(sub, courses, bundles, plan\.currency\)/);
  assert.match(admin, /paidFor\(subscriber, item, currency\) \+ \(Number\(subscriber\.priorPaid\?\.\[item\]\) \|\| 0\)/);
  const modal = read('admin/components/PaymentModal.tsx');
  // The instalment list and «كل المتبقي» used the catalogue.
  assert.match(modal, /const px = agreedPriceFor\(subject, cid, isBnd/);
  assert.match(modal, /const bal = _effPx > 0 \? Math\.max\(0, _effPx - alreadyPaid\) : 0;/);
  // The filters and the total read the table's own items (onlineSectionReview.test.js).
  assert.match(read('admin/pages/dashboard/tabs/onlineClientsUtils.ts'), /const items = clientItems\(subscriber, courses, bundles, clientCurrency\(subscriber\)\);/);
  assert.match(read('api/lib/paymentReceipt.js'), /await itemBalances\(db, \{ tenantId, subscriberId: payment\.subscriber_id \}\)/);
  assert.match(read('api/routes/crm-tools.js'), /const prior = priorPaidTotal\(crmJson\);/);
});

test('the dialog hands the handler the price it shows; an instalment only a price the desk changed', () => {
  const modal = read('admin/components/PaymentModal.tsx');
  assert.match(modal, /customExpected: d\.bookingType === 'installment'\s+\? \(changedPrice \? shownPrice : ''\)/);
  const handler = read('admin/pages/dashboard/dashboardPaymentHandlers.ts');
  assert.match(handler, /\? \(_singleCustom > 0 \? _singleCustom : undefined\)/);
  // «مشترك جديد»: each course's own price or discount, not just the first's.
  const account = read('api/routes/auth.js');
  assert.match(account, /if \(price\) await setAgreedPrice\(conn, \{ tenantId, subscriberId: responseSubscriber\.id, courseId, bundleId, price \}\);/);
});

test('the access panel edits the price, what was paid before, the lectures and the subscription date', () => {
  const route = read('api/routes/core/content.js');
  assert.match(route, /router\.put\('\/api\/admin\/subscribers\/:id\/item-money'/);
  assert.match(route, /UPDATE enrollments SET access_type=\?, lecture_limit=\?, updated_at=NOW\(\)/);
  assert.match(route, /UPDATE enrollments SET enrolled_at=\?, updated_at=NOW\(\)/);
  // Both writes check the client is theirs, as the money screens do.
  assert.equal((route.match(/const scoped = await scopedSubscriber\(req, req\.params\.id, tenantId\);/g) || []).length, 2);
  const panel = read('admin/pages/dashboard/tabs/online-clients-sections/ClientCourseAccessPanel.tsx');
  for (const label of ['السعر الإجمالي', 'مدفوع قبل السيستم', 'المحاضرات المفتوحة', 'كل المحاضرات', 'تاريخ الاشتراك', 'حدد النهاية']) {
    assert.ok(panel.includes(label), label);
  }
});

test('the WhatsApp button opens the chat; «عملائي» is gone; the old price window is gone', () => {
  const table = read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx');
  assert.match(table, /<a title="واتساب" href=\{waLink\(row\.phone\) \|\| undefined\} target="_blank"/);
  assert.doesNotMatch(table, /setSubWaRow/);
  const strip = read('admin/pages/dashboard/tabs/OnlineClientsKpiStrip.tsx');
  assert.doesNotMatch(strip, /عملائي/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'admin/pages/dashboard/tabs/OnlineClientCourseDetailsModal.tsx')));
});
