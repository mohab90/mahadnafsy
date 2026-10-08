'use strict';
const { financeRouteSource } = require('./_authRouteSource');

// «سجل النظام … اسم المسئول مش ايميله ومحتاجين يضاف القسم», the certificates
// desk («اتسلم لشركة الشحن … استلم للعميل او حصل مرتجع», تعديل, الفرع,
// المسئول, المدفوع والمتبقي, جهه التحصيل, ملاحظات), the refunds desk (the
// course under the client, تواصل, البروفايل, النتيجة, رفع للإدارة, filters),
// «التواصل والمتابعه عمود واحد», collection kept off course access, a track
// held course by course shown as the track, and «تكملة» — a course grown into
// a track.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const { departmentOf, describeLabel, describeRequest, summarizeBody } = require('../lib/activityDescribe');
const { nameCompletedTracks, planTracks } = require('../lib/trackNaming');

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

test('a request reads as what was done, in which part of the system', () => {
  assert.deepEqual(describeRequest('POST', '/api/admin/leads/move-to-archive'), { area: 'العملاء المحتملين', text: 'نقل ليدات للأرشيف' });
  assert.deepEqual(describeRequest('POST', '/api/admin/subscriber-payments'), { area: 'الحسابات والمدفوعات', text: 'تسجيل دفعة' });
  assert.equal(describeRequest('DELETE', '/api/admin/subscribers/sub-1').text, 'أرشفة عميل');
  assert.equal(describeRequest('PUT', '/api/admin/certificate-requests/c1/details').text, 'تعديل بيانات شهادة');
  // The 70,000 old rows kept the path in their label.
  assert.equal(describeLabel('create /api/admin/crm/leads/lead-1/interactions', 'crm').text, 'تسجيل تواصل مع ليد');
  assert.equal(describeLabel('اتمسح «علم النفس» من العميل — غلط', 'subscriber').area, 'العملاء');
  assert.equal(describeLabel('update /api/admin/settings', 'settings').text, 'تعديل الإعدادات');
  assert.equal(describeLabel('{"seo":{"error":"403"}}', 'ai-autopilot').text, 'تشغيل المساعد الذكي اليومي');
});

test('the department is the employee\'s, the owner\'s is the management', () => {
  assert.equal(departmentOf({ role: 'COLLECTION' }), 'التحصيل');
  assert.equal(departmentOf({ role: 'daqqi_manager' }), 'فرع الدقي');
  assert.equal(departmentOf({ isOwner: true }), 'الإدارة');
  assert.equal(departmentOf({ role: 'sales', hrDepartment: 'فريق المبيعات ٢' }), 'فريق المبيعات ٢');
});

test('what was sent is kept, never a secret', () => {
  const summary = summarizeBody({ name: 'منى', password: 'x', otpCode: '1234', token: 't', courseIds: ['a', 'b'], note: 'تم' });
  assert.match(summary, /name: منى/);
  assert.match(summary, /courseIds: 2 عنصر/);
  assert.doesNotMatch(summary, /password|otp|token/i);
});

test('the audit row carries the name, the department and the details', () => {
  const audit = read('api/middleware/adminAudit.js');
  assert.match(audit, /INSERT INTO activity_logs \(id, tenant_id, action, entity, entity_id, label, actor, actor_name, department, details\)/);
  assert.match(audit, /req\.staffRecord\?\.name/);
  assert.match(audit, /NOT_WORTH_A_ROW/);
  const route = read('api/routes/admin-operations.js');
  assert.match(route, /LEFT JOIN staff st ON st\.tenant_id=a\.tenant_id AND \(st\.email=a\.actor OR st\.id=a\.actor\)/);
  // A departed employee's address is «موظف سابق», never the address (8 Oct 2026).
  assert.ok(route.includes("actorName: row.actor_name || (isOwner ? 'المالك' : SYSTEM_ACTORS[row.actor] || (looksLikeAddress(row.actor) ? 'موظف سابق' : row.actor))"));
  assert.match(read('api/migrations/229_v26_activity_names_and_certificate_shipping.sql'), /actor_name varchar\(255\)/);
  const tab = read('admin/pages/dashboard/tabs/ActivityTab.tsx');
  assert.match(tab, /\/admin\/activity-logs\?\$\{params\}/, 'filtered on the server');
  assert.match(tab, /header: 'القسم'/);
});

test('the biggest track wins, and a course is under one track only', () => {
  const tracks = [
    { id: 'pro', title: 'المعالج المحترف', courses: ['c1', 'c2', 'c3', 'c4'] },
    { id: 'small', title: 'مسار صغير', courses: ['c1', 'c2'] },
    { id: 'other', title: 'مسار ناقص', courses: ['c5', 'c6', 'c7'] },
  ];
  const plan = planTracks(tracks, ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(id => ({ id: `e-${id}`, course_id: id })));
  assert.deepEqual(plan.map(entry => entry.track.id), ['pro']);
  assert.deepEqual(plan[0].enrolmentIds, ['e-c1', 'e-c2', 'e-c3', 'e-c4']);
});

test('a client holding every course of a track holds the track, money and all', async () => {
  const db = fakeDb([
    [/SELECT id, course_id FROM enrollments/, [[{ id: 'e1', course_id: 'c1' }, { id: 'e2', course_id: 'c2' }, { id: 'e3', course_id: 'c3' }]]],
    [/SELECT course_id, bundle_id FROM enrollments/, [[{ course_id: 'c1', bundle_id: null }, { course_id: 'c2', bundle_id: null }, { course_id: 'c3', bundle_id: null }]]],
    [/FROM payments WHERE tenant_id=\? AND subscriber_id=\?/, [[]]],
    [/FROM bundles b JOIN bundle_courses/, [[
      { id: 'b1', title: 'دبلومة علم النفس المتكامل', course_id: 'c1' },
      { id: 'b1', title: 'دبلومة علم النفس المتكامل', course_id: 'c2' },
      { id: 'b1', title: 'دبلومة علم النفس المتكامل', course_id: 'c3' },
    ]]],
    [/SELECT crm_json FROM subscribers/, [[{ crm_json: JSON.stringify({ customPrices: { c1: 1000, c2: 1500, c3: 2500 }, priorPaid: { c1: 500 } }) }]]],
    [/UPDATE payments SET bundle_id/, [{ affectedRows: 2 }]],
  ]);
  const done = await nameCompletedTracks(db, { tenantId: 't', subscriberId: 's1', actor: 'test' });
  assert.deepEqual(done, [{ trackId: 'b1', title: 'دبلومة علم النفس المتكامل', courses: 3, paymentsMoved: 2 }]);
  assert.deepEqual(find(db, /UPDATE enrollments SET bundle_id/).params, ['b1', 't', 'e1', 'e2', 'e3']);
  assert.match(find(db, /UPDATE payments SET bundle_id/).sql, /bundle_id IS NULL/, 'a payment already on a track stays there');
  const crm = JSON.parse(find(db, /UPDATE subscribers SET crm_json/).params[0]);
  assert.deepEqual(crm.customPrices, { 'bundle:b1': 5000 }, 'the track costs what its courses were agreed at together');
  assert.deepEqual(crm.priorPaid, { 'bundle:b1': 500 });
  assert.equal(find(db, /INSERT INTO activity_logs/).params[2], 'track_named');
});

test('nobody\'s balance moves: a track priced in part keeps what was owed', async () => {
  const answers = crmJson => [
    [/SELECT id, course_id FROM enrollments/, [[{ id: 'e1', course_id: 'c1' }, { id: 'e2', course_id: 'c2' }]]],
    [/SELECT course_id, bundle_id FROM enrollments/, [[{ course_id: 'c1', bundle_id: null }, { course_id: 'c2', bundle_id: null }]]],
    [/FROM payments WHERE tenant_id=\? AND subscriber_id=\?/, [[]]],
    [/FROM bundles b JOIN bundle_courses/, [[{ id: 'b2', title: 'م', course_id: 'c1' }, { id: 'b2', title: 'م', course_id: 'c2' }]]],
    [/SELECT crm_json FROM subscribers/, [[{ crm_json: JSON.stringify(crmJson) }]]],
  ];
  const priced = fakeDb(answers({ customPrices: { c1: 900 } }));
  await nameCompletedTracks(priced, { tenantId: 't', subscriberId: 's1' });
  assert.deepEqual(JSON.parse(find(priced, /UPDATE subscribers SET crm_json/).params[0]).customPrices, { 'bundle:b2': 900 },
    'c1 owed 900 and c2 nothing known: the track owes the same 900');

  const bare = fakeDb(answers({}));
  await nameCompletedTracks(bare, { tenantId: 't', subscriberId: 's1' });
  assert.deepEqual(JSON.parse(find(bare, /UPDATE subscribers SET crm_json/).params[0]).customPrices, {});
  assert.match(find(bare, /INSERT INTO activity_logs/).params[5], /بسعر الكتالوج/, 'no money on it: the catalogue');
});

test('a dry run names nothing', async () => {
  const db = fakeDb([
    [/SELECT id, course_id FROM enrollments/, [[{ id: 'e1', course_id: 'c1' }, { id: 'e2', course_id: 'c2' }]]],
  ]);
  const plan = await nameCompletedTracks(db, {
    tenantId: 't', subscriberId: 's1', dryRun: true, tracks: [{ id: 'b', title: 'م', courses: ['c1', 'c2'] }],
  });
  assert.equal(plan.length, 1);
  assert.ok(!db.calls.some(call => /^\s*UPDATE|INSERT/.test(call.sql)));
});

test('grants run the rule, so the table, the panel and the payment dialog agree', () => {
  const entitlements = read('api/lib/entitlements.js');
  assert.equal((entitlements.match(/await nameCompletedTracks\(db, \{ tenantId, subscriberId, actor \}\);/g) || []).length, 2);
});

test('«تكملة»: the course joins the track, its money with it, access untouched', async () => {
  const entitlements = require('../lib/entitlements');
  const granted = [];
  const original = entitlements.grantCourseSelections;
  entitlements.grantCourseSelections = async args => { granted.push(args); };
  try {
    delete require.cache[require.resolve('../lib/clientCourseActions')];
    const { upgradeClientCourse } = require('../lib/clientCourseActions');
    const db = fakeDb([
      [/FROM bundle_courses WHERE tenant_id=\? AND bundle_id=\?/, [[{ course_id: 'c1' }, { course_id: 'c2' }]]],
      [/FROM enrollments .* FOR UPDATE/, [[{ id: 'e1', course_id: 'c1', status: 'active', access_type: 'full' }]]],
      [/FROM courses/, [[{ title: 'الصحة النفسية' }]]],
      [/FROM bundles WHERE id=\?/, [[{ title: 'دبلومة علم النفس المتكامل' }]]],
      [/SELECT COALESCE\(SUM\(amount\),0\) AS total/, [[{ total: 1200, currency: 'EGP' }]]],
      [/SELECT crm_json FROM subscribers/, [[{ crm_json: JSON.stringify({ priorPaid: { c1: 300 } }) }]]],
    ]);
    const result = await upgradeClientCourse(db, {
      tenantId: 't', subscriber: { id: 's1' }, item: 'c1', toItem: 'bundle:b1', actor: 'سيلز',
    });
    assert.equal(result.carried, 1500);
    assert.deepEqual(find(db, /UPDATE enrollments SET bundle_id/).params, ['b1', 't', 'e1']);
    assert.ok(!find(db, /status='removed'/), 'the course they had stays open');
    assert.equal(granted.length, 0, 'the track opens through the payment, not the upgrade');
    assert.deepEqual(JSON.parse(find(db, /UPDATE subscribers SET crm_json/).params[0]).priorPaid, { 'bundle:b1': 300 });
    assert.equal(find(db, /INSERT INTO activity_logs/).params[2], 'course_upgraded');

    const notInTrack = fakeDb([
      [/FROM bundle_courses WHERE tenant_id=\? AND bundle_id=\?/, [[{ course_id: 'c9' }]]],
      [/FROM enrollments .* FOR UPDATE/, [[{ id: 'e1', course_id: 'c1', status: 'active' }]]],
    ]);
    await assert.rejects(upgradeClientCourse(notInTrack, { tenantId: 't', subscriber: { id: 's1' }, item: 'c1', toItem: 'bundle:b9' }),
      error => error.statusCode === 400);
  } finally {
    entitlements.grantCourseSelections = original;
  }
  const route = read('api/routes/core/content.js');
  assert.match(route, /'\/api\/admin\/subscribers\/:id\/course-upgrade', requireAuth, requireAdminOrStaff, requirePermission\('manage_payments'\)/);
  const modal = read('admin/components/PaymentModal.tsx');
  assert.match(modal, /course-upgrade`, \{/);
  assert.match(modal, /lb: 'تكملة لمسار'/);
});

test('certificates: paid before the system is paid, and the courier has a way back', () => {
  const routes = read('api/routes/certificates.js');
  // Since 8 Oct 2026 the desk moves a paid certificate freely between the seven
  // stages, the courier's way back included (aCertificateMovesOnlyPaidInFull).
  assert.ok(routes.includes("const PAID_STAGES = ['PAID', 'IN_PROGRESS', 'ISSUED', 'AT_BRANCH', 'SHIPPED', 'DELIVERED', 'RETURNED'];"));
  assert.ok(routes.includes('return due > 0 && Number(request.paid_amount) >= due;'));
  assert.match(routes, /router\.put\('\/api\/admin\/certificate-requests\/:id\/details'/);
  assert.match(routes, /collectionParty: collectionPartyOf\(row\)/);
  assert.match(routes, /action: 'certificate_status'/);
  assert.match(read('api/migrations/229_v26_activity_names_and_certificate_shipping.sql'), /'DELIVERED','RETURNED'\)/);

  const tab = read('admin/pages/dashboard/tabs/CertRequestsTab.tsx');
  assert.match(tab, /shipped: +\{ label: 'اتشحنت'/);
  assert.match(tab, /returned: +\{ label: 'مرتجع'/);
  for (const header of ['التليفون', 'الفرع', 'المدفوع', 'المتبقي', 'جهة التحصيل', 'المسئول', 'ملاحظات']) {
    assert.ok(tab.includes(`<th className={th}>${header}</th>`), header);
  }
  assert.match(tab, /mysqlAdmin\.updateCertificateDetails/);
  assert.match(tab, /mysqlAdmin\.listAllCertificateRequests\(\)/, 'read from the server, not the loaded clients');
});

test('staff are not shown settings they cannot save', () => {
  assert.match(read('admin/pages/dashboard/DashboardDirectContentRoutes.tsx'), /pricing=\{canEditSettings \?/);
  assert.match(read('admin/pages/dashboard/tabs/ConsultationsTab.tsx'), /TABS\.filter\(item => item\.key !== 'settings' \|\| canEditSettings\)/);
});

test('refunds: the course under the client, contact and its result, organised actions, filters', () => {
  const finance = financeRouteSource();
  assert.match(finance, /COALESCE\(NULLIF\(c\.title_ar, ''\), c\.title, b\.title\) AS course_title/);
  assert.match(finance, /LEFT JOIN bundles b ON b\.id = COALESCE\(p\.bundle_id, IF\(rr\.course_item LIKE 'bundle:%'/);
  assert.match(finance, /JSON_OBJECT\('outcome', cm\.outcome/);
  const panel = read('admin/pages/dashboard/tabs/financial/FinancialRefundsPanel.tsx');
  assert.match(panel, /row\.course_title \|\| 'كورس غير محدد'/);
  assert.match(panel, /<ClientContactDialog/);
  assert.match(panel, /navigate\(`\/client\/\$\{row\.client_code \|\| row\.subscriber_id\}`\)/);
  assert.match(panel, /النتيجة <ChevronDown/);
  assert.match(panel, /\['ESCALATED', 'مرفوع للإدارة'\]/);
  for (const label of ['الكورس', 'الفرع', 'المسئول', 'السيلز']) assert.ok(panel.includes(`aria-label="${label}"`), label);
  assert.match(panel, /const notifyRef = useRef\(notify\);/, 'an inline notify no longer reloads the list');
  // 8 Oct 2026: the course its own column, the phone under the name, the
  // actions one small row, and delete the admin's own button.
  assert.match(panel, /<th className=\{th\}>الكورس<\/th>/);
  assert.match(panel, /\{row\.subscriber_phone && <div/);
  assert.match(panel, /flex flex-nowrap items-center gap-1/);
  assert.match(panel, /\{isAdmin && \(\s*<button disabled=\{working\} onClick=\{\(\) => void remove\(row\)\}/);
});

test('contact: a result is enough, and it is the one column', () => {
  assert.match(read('api/routes/admin/subscribers.js'), /if \(!notes\.trim\(\) && !outcome\)/);
  assert.match(read('admin/pages/unified-client/ClientContactLog.tsx'), /const ready = !!draft\.notes\.trim\(\) \|\| !!draft\.outcome;/);
  const table = read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx');
  assert.match(table, />نتيجة التواصل والمتابعة</);
  assert.ok(!table.includes('vc.followup'), 'the follow-up is inside the one column');
  assert.match(table, /lastComm\.staffName \|\|/);
});

test('collection is not shown a client\'s courses tab', () => {
  assert.match(read('admin/pages/unified-client/useUnifiedClientPermissions.ts'), /const canSeeCourses = String\(currentStaff\?\.role \|\| ''\)\.toLowerCase\(\) !== 'collection';/);
  assert.match(read('admin/pages/UnifiedClientPage.tsx'), /isSub && canSeeCourses && activeTab === 'courses'/);
  assert.match(read('admin/pages/unified-client/UnifiedClientTabs.tsx'), /\.\.\.\(showCourses \?/);
});
