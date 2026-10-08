'use strict';
const { financeRouteSource } = require('./_authRouteSource');

// «خلي في امكانيه للمديرين بمسح كورس عميل … استرداد جزئي لكورس محدد للعميل او
// تحويل لكورس محدد … اي مسح لكورس او اي تحويل … لازم تتسجل في هيستوري العميل
// ومين اللى نفذ المهمه … حسابات الدقي ليه بيظهرله فلوس بالريال … ومحتاجين يظهر
// كل وسائل الدفع اللى تمت للدقي وكل وسيله دفع خزنتها كام».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

// Access is granted and taken through lib/entitlements.js; what matters here is
// what the actions ask of it.
const revoked = [];
const granted = [];
const realEntitlements = require('../lib/entitlements');
const entitlementsFile = require.resolve('../lib/entitlements');
require.cache[entitlementsFile] = {
  id: entitlementsFile, filename: entitlementsFile, loaded: true,
  exports: {
    ...realEntitlements,
    revokeCourseEntitlement: async args => { revoked.push(args); return { changed: true }; },
    grantCourseSelections: async args => { granted.push(args); return { granted: 1 }; },
  },
};
delete require.cache[require.resolve('../lib/clientCourseActions')];
const { isCourseManager, removeClientCourse, transferClientCourse } = require('../lib/clientCourseActions');
const { listCustomerTimeline } = require('../lib/customerTimeline');

function fakeDb(answers) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ');
      calls.push({ sql: flat, params });
      for (const [pattern, answer] of answers) {
        if (pattern.test(flat)) return typeof answer === 'function' ? answer(params) : answer;
      }
      return [{ affectedRows: 0 }];
    },
  };
}
const find = (db, pattern) => db.calls.find(call => pattern.test(call.sql));
const crmWritten = db => JSON.parse(find(db, /UPDATE subscribers SET crm_json/).params[0]);
const logged = db => find(db, /INSERT INTO activity_logs/).params;

test('only the managers delete a course', () => {
  for (const role of ['admin', 'MANAGER', 'online_manager', 'daqqi_manager', 'sales_collection_manager']) {
    assert.ok(isCourseManager({ staffRecord: { role } }), role);
  }
  for (const role of ['sales', 'collection', 'support', 'reception_daqqi', 'accountant']) {
    assert.ok(!isCourseManager({ staffRecord: { role } }), role);
  }
  assert.ok(isCourseManager({ isSuperAdmin: true }));
});

test('a deleted course leaves the client, its rounds and its price — and the history says who', async () => {
  revoked.length = 0;
  const db = fakeDb([
    [/FROM enrollments .* FOR UPDATE/, [[{ id: 'e1', course_id: 'c1', status: 'active' }]]],
    [/FROM courses/, [[{ title: 'علم النفس الإكلينيكي' }]]],
    [/SELECT crm_json/, [[{ crm_json: JSON.stringify({ customPrices: { c1: 3000, c9: 1 }, priorPaid: { c1: 500 } }) }]]],
  ]);
  const result = await removeClientCourse(db, {
    tenantId: 't', subscriber: { id: 's1' }, item: 'c1', reason: 'اتسجل غلط', actor: 'مدير الدقي',
  });
  assert.equal(result.removed, 1);
  assert.equal(revoked[0].courseId, 'c1', 'access is taken the way a lock takes it');
  const removed = find(db, /UPDATE enrollments SET status='removed'/);
  assert.deepEqual(removed.params, ['t', 'e1'], 'and the enrolment leaves every list');
  assert.ok(find(db, /DELETE a FROM daqqi_attendees .* r\.status<>'finished'/), 'out of the rounds still running');
  assert.deepEqual(crmWritten(db), { customPrices: { c9: 1 }, priorPaid: {} }, 'its price goes, other items keep theirs');
  const [, , action, entity, subscriberId, label, actor] = logged(db);
  assert.equal(action, 'course_removed');
  assert.equal(entity, 'subscriber');
  assert.equal(subscriberId, 's1');
  assert.equal(actor, 'مدير الدقي');
  assert.match(label, /علم النفس الإكلينيكي/);
  assert.match(label, /اتسجل غلط/);
  assert.match(label, /500/, 'money paid before the system is named, not lost silently');
  assert.ok(!find(db, /UPDATE payments/), 'a deletion moves no money');
});

test('deleting refuses nothing to delete', async () => {
  const empty = fakeDb([[/FROM enrollments/, [[]]]]);
  await assert.rejects(removeClientCourse(empty, { tenantId: 't', subscriber: { id: 's1' }, item: 'c1', reason: 'x' }),
    error => error.statusCode === 404);
  await assert.rejects(removeClientCourse(empty, { tenantId: 't', subscriber: { id: 's1' }, item: '', reason: 'x' }),
    error => error.statusCode === 400);
});

test('a transfer carries access, the money paid and what was paid before the system', async () => {
  revoked.length = 0;
  granted.length = 0;
  const db = fakeDb([
    [/FROM enrollments .* FOR UPDATE/, [[{ id: 'e1', course_id: 'c1', status: 'active', access_type: 'limited', lecture_limit: 4 }]]],
    [/FROM courses/, params => [[{ title: params[0] === 'c2' ? 'الكورس الجديد' : 'الكورس القديم' }]]],
    [/SELECT COALESCE\(SUM\(amount\),0\) AS total/, [[{ total: 2000, currency: 'EGP' }]]],
    [/UPDATE payments SET course_id/, [{ affectedRows: 2 }]],
    [/SELECT crm_json/, [[{ crm_json: JSON.stringify({ priorPaid: { c1: 300 } }) }]]],
  ]);
  const result = await transferClientCourse(db, {
    tenantId: 't', subscriber: { id: 's1', branch_id: 'branch-daqqi' }, item: 'c1', toItem: 'c2', reason: 'طلب العميل', actor: 'الحسابات',
  });
  assert.equal(result.paymentsMoved, 2);
  assert.equal(revoked[0].courseId, 'c1');
  assert.deepEqual(granted[0].selections, [{ courseId: 'c2', accessType: 'limited', lectureLimit: 4 }],
    'a client on instalments keeps the lectures they had reached');
  assert.equal(granted[0].branchId, 'branch-daqqi');
  const moved = find(db, /UPDATE payments SET course_id/);
  assert.match(moved.sql, /course_id=\? AND bundle_id IS NULL/, 'the old course alone, not a track holding it');
  assert.deepEqual(moved.params.slice(0, 3), ['c2', null, 'الكورس الجديد']);
  assert.match(moved.sql, /course_expected=NULL/, 'the old price belonged to the old course');
  assert.deepEqual(crmWritten(db).priorPaid, { c2: 300 });
  const label = logged(db)[5];
  assert.match(label, /الكورس القديم/);
  assert.match(label, /الكورس الجديد/);
  assert.match(label, /2,000 EGP/);
  assert.equal(logged(db)[6], 'الحسابات');
});

test('a transfer refuses the course it is already', async () => {
  const db = fakeDb([]);
  await assert.rejects(transferClientCourse(db, { tenantId: 't', subscriber: { id: 's1' }, item: 'c1', toItem: 'c1' }),
    error => error.statusCode === 400);
});

test('the history names who did it for the desk, and keeps it from the client', async () => {
  const rows = [
    { category: 'client', event_type: 'course_removed', entity_id: 'a1', title: 'اتمسح', actor: 'st-1' },
    { category: 'payment', event_type: 'payment_paid', entity_id: 'p1', title: 'كورس', actor: 'walid' },
    // «فتح كورس · بواسطة hana@mahadnafsy.com» (8 Oct 2026): an address reads as the name.
    { category: 'learning', event_type: 'entitlement_granted', entity_id: 'e1', title: 'كورس', actor: 'Hana@Example.test' },
    { category: 'learning', event_type: 'entitlement_granted', entity_id: 'e2', title: 'كورس', actor: 'gone@example.test' },
  ];
  const db = fakeDb([
    [/FROM activity_logs a/, [rows]],
    [/SELECT id, name, email FROM staff WHERE tenant_id=\?/, [[{ id: 'st-1', name: 'هناء', email: null }, { id: 'st-2', name: 'هنا', email: 'Hana@Example.test' }]]],
  ]);
  const staff = await listCustomerTimeline('t', 's1', db, { staff: true });
  assert.equal(staff[0].actor, 'هناء', 'a staff id reads as a name');
  assert.equal(staff[1].actor, 'walid');
  assert.equal(staff[2].actor, 'هنا', 'an address reads as the name');
  assert.equal(staff[3].actor, 'موظف سابق', 'an address no one has is never shown');
  assert.match(find(db, /FROM activity_logs a/).sql, /a\.entity='subscriber' AND a\.entity_id=\?/);

  const own = await listCustomerTimeline('t', 's1', fakeDb([[/FROM activity_logs a/, [rows]]]));
  assert.deepEqual(own.map(row => row.category), ['payment', 'learning', 'learning'], 'the desk\'s record is not the client\'s');
  assert.ok(own.every(row => !('actor' in row)));
  assert.match(read('api/routes/admin/subscribers.js'), /listCustomerTimeline\(req\.tenantId, subscriber\.id, pool, \{ staff: true \}\)/);
});

test('the routes: managers delete, managers and accounts transfer, with a reason on a deletion', () => {
  const routes = read('api/routes/core/content.js');
  assert.match(routes, /'\/api\/admin\/subscribers\/:id\/course-remove'[\s\S]{0,200}courseActionRoute\('remove'/);
  assert.match(routes, /'\/api\/admin\/subscribers\/:id\/course-transfer'[\s\S]{0,200}courseActionRoute\('transfer'/);
  assert.match(routes, /!isCourseManager\(req\) && !\(action === 'transfer' && role === 'accountant'\)/);
  assert.match(routes, /action === 'remove' && !reason/);
  assert.match(routes, /scopedSubscriber\(req, req\.params\.id, tenantId\)/, 'a branch manager acts on their own clients only');
  assert.match(routes, /e\.status <> 'removed'/, 'a deleted course is off the client\'s file');
});

test('a refund names a course, and the payment behind it is optional', () => {
  const route = read('api/routes/admin-utils.js');
  const byAdmin = route.slice(route.indexOf("'/api/admin/refund-requests/by-admin'"), route.indexOf("'/api/admin/refund-requests', requireAuth"));
  assert.match(byAdmin, /if \(!payment_id && !course_item\)/);
  assert.match(byAdmin, /if \(payment_id\) \{/, 'the payment checks run only when there is one');
  assert.match(byAdmin, /paidForItem > 0 && requestedAmount - paidForItem > 0\.01/, 'held to what was paid for the course');
  assert.match(byAdmin, /subInTenant\.branch_id/, 'filed under the client\'s branch, which the refunds screen is scoped by');
  assert.match(byAdmin, /action: 'refund_requested'/);
  assert.match(byAdmin, /!refund_method \|\| refund_method === 'same_as_payment'/, 'with no payment, a named box');

  const finance = financeRouteSource();
  assert.match(finance, /!rr\.payment_id && !rr\.course_item/);
  assert.match(finance, /applyUnlinkedRefund\(\{/);
  assert.match(finance, /action: `refund_\$\{normalizedStatus\.toLowerCase\(\)\}`/);

  const refunds = read('api/lib/refunds.js');
  const unlinked = refunds.slice(refunds.indexOf('async function applyUnlinkedRefund'), refunds.indexOf('async function applyRefundReversal'));
  assert.match(unlinked, /assertWritable/, 'a closed period stays closed');
  assert.match(unlinked, /insertRefundRow\(conn/);
  assert.match(unlinked, /method,/, 'out of the box named on the request');
  assert.match(unlinked, /subscriber\.branch_id/);

  const migration = read('api/migrations/228_v26_refund_course_item.sql');
  assert.match(migration, /course_item varchar\(80\)/);
  assert.match(migration, /'HANDLING'/, 'the status the refund desk has offered since 198');
});

test('a branch\'s money is its own clients\' money, box by box', () => {
  const finance = financeRouteSource();
  const boxes = finance.slice(finance.indexOf("'/api/admin/finance/boxes'"), finance.indexOf("'/api/admin/finance/refunds', requireAuth"));
  assert.match(boxes, /requirePermission\('view_financial'\)/);
  assert.match(boxes, /p\.deleted_at IS NULL/);
  assert.match(boxes, /p\.branch_id = \? AND \(s\.id IS NULL OR s\.branch_id = p\.branch_id\)/);
  assert.match(finance, /const BOX_WINDOWS = \[1, 7, 15, 30\];/);
  assert.match(read('api/routes/payments.js'), /p\.branch_id = \? AND \(s\.id IS NULL OR s\.branch_id = p\.branch_id\)/);
});

test('«حسابات الدقي»: its boxes first, its own payments, no riyal, no company screens', () => {
  const tab = read('admin/pages/dashboard/tabs/FinancialTab.tsx');
  assert.match(tab, /const defaultScreen: FinancialSubTab = branchFilter \? 'boxes' : 'cockpit';/);
  assert.match(tab, /getPayments\(undefined, undefined, undefined, branchFilter\)/);
  assert.match(tab, /\{!branchFilter && <div className="flex items-center gap-2 bg-gray-50/, 'the exchange-rate widget is the main books\' only');
  assert.match(tab, /allowed=\{branchFilter \? BRANCH_SUB_TABS : undefined\}/);

  const utils = read('admin/pages/dashboard/tabs/financial/financialTabUtils.ts');
  const list = utils.slice(utils.indexOf('BRANCH_SUB_TABS'), utils.indexOf('];', utils.indexOf('BRANCH_SUB_TABS')));
  const offered = [...list.matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
  // The period statement too: GET /api/admin/finance/statement scopes it to the branch's own money, in pounds.
  assert.deepEqual(offered, ['statement', 'boxes', 'orders', 'expenses', 'review', 'proofs', 'refunds', 'installments', 'aging']);
});

test('a branch client\'s file shows what they bought, not an online course', () => {
  const panel = read('admin/pages/dashboard/tabs/online-clients-sections/ClientCourseAccessPanel.tsx');
  assert.match(panel, /const inBranch = !isOnlineClient\(subscriber\);/);
  assert.match(panel, /\{inBranch \? \(/);
  assert.match(panel, /course-remove/);
  assert.match(panel, /course-transfer/);
  assert.match(panel, /<AddRefundModal subscriber=\{subscriber\} item=\{refundItem\.item\}/);
  const tab = read('admin/pages/unified-client/UnifiedClientCoursesTab.tsx');
  assert.match(tab, /!isOnlineClient\(subscriber\) \? null/);

  const modal = read('admin/pages/dashboard/tabs/financial/AddRefundModal.tsx');
  assert.match(modal, /<option value="">بدون دفعة مسجّلة<\/option>/);
  assert.match(modal, /payment_id: payment\?\.id \|\| null/);
  assert.match(modal, /course_item: courseItem \|\| null/);
  assert.match(modal, /refund_method: payment \? method : box/);
});

// «جدول كورسات الدقي»: one path under a course, rows in two shades, collected and
// remaining apart, a searchable «إضافة عملاء», and «اشتغلت / ماشتغلتش».
test('the Dokki schedule', () => {
  const rounds = read('api/routes/daqqi-rounds.js');
  assert.match(rounds, /held_weeks_json=COALESCE\(\?, held_weeks_json\)/, 'a screen that does not send the weeks keeps them');
  assert.match(read('api/migrations/227_v26_daqqi_held_weeks.sql'), /held_weeks_json text/);
  assert.match(read('api/lib/daqqiAccess.js'), /'RECEPTION_DAQQI', 'SUPPORT'/, 'customer service reads the schedule from its bar');

  const paths = read('api/routes/dokki-operations.js');
  assert.match(paths, /router\.put\('\/api\/admin\/dokki\/course-paths'[^\n]*requireDaqqiManager/);
  assert.match(paths, /FROM bundle_courses WHERE tenant_id=\? AND bundle_id=\? AND course_id=\?/, 'a path the course is in');

  // The desk's save sent the room it had been given, and it had been given none.
  const own = read('admin/pages/dashboard/useStaffOwnData.ts');
  assert.match(own, /room: String\(r\.room \|\| ''\)/);

  const row = read('admin/pages/dashboard/tabs/daqqi/DaqqiRoundRow.tsx');
  assert.match(row, /index % 2 \? 'bg-gray-50' : 'bg-white'/);
  assert.match(row, /handleDaqqiMarkWeek\(round\.id, true\)/);
  assert.match(row, /handleDaqqiMarkWeek\(round\.id, false\)/);
  assert.match(row, /paths\.find\(bundle => bundle\.id === coursePath\) \|\| paths\[0\]/, 'one path, the chosen one');

  const modal = read('admin/pages/dashboard/tabs/daqqi/DaqqiAddClientsModal.tsx');
  assert.match(modal, /بحث بالاسم أو رقم التليفون/);
  assert.match(modal, /housing === 'unhoused' && assignedSubIds\.has\(s\.id\)/);
  assert.match(modal, /isEnrolledInCourse\(bundles, s\.enrolledCourseIds \|\| \[\], wantedCourse\)/);

  const tab = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.match(tab, /المحصّل<\/th>\s*<th[^>]*>المتبقي<\/th>/);
  assert.match(tab, /setDaqqiAddClientsRoundId\(r\.id\)/, 'the calendar adds clients too');
});
