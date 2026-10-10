'use strict';
const { leadsRouteSource, sourceOf } = require('./_authRouteSource');

// The staff accounts, 28 September:
//   «حساب وفاء ظاهر اسماء الكورسات غلط» — no employee but an admin ever loaded
//     the catalogue, so courses were named from a browser cache or the demo seed;
//   «يقدر يطلب اجازه او اذن تاخير صباحي او مسائي وبيقدر يطلب سلفه وكل دا بيروح
//     لحساب الموارد البشرية»;
//   «ليه بيظهر في حساب التحصيل قيم العملاء المحتملين كامله؟ خلي يظهرله زي ما
//     بيظهر للسيلز»;
//   «اوزع الداتا علي فريق التحصيل ... في الداتا المتبقيه»;
//   «يضيف مشترك جديد ولكن لا يضاف حتي يراجع تحويله ومدفوعاته من حساب المسئول
//     واي حجز لازم ميسمعش لحد ما المسئول يتاكد من المدفوعات ويربطه بتحويل»;
//   «غير شكل صفحه المدفوعات ... ويفضل التصميم الحالي للادارة والمحاسب
//     والمسئول للاونلاين فقط».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function loadAdminModule(rel) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, rel)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const pools = loadAdminModule('admin/pages/dashboard/tabs/leads/leadSourceGroups.ts');

test('every employee loads the catalogue; only the community waits on its permission', () => {
  const context = read('admin/context/SiteDataContext.tsx');
  assert.doesNotMatch(context, /if \(!canReadCommunity\) return;/);
  assert.match(context, /if \(canReadCommunity\) setTimeout\(\(\) => \{/);
  // The catalogue load for non-admins is still there, after the community's.
  const effect = context.slice(context.indexOf('const canReadCommunity'), context.indexOf('// Load inbox for admin'));
  assert.match(effect, /if \(!isAdmin\) \{[\s\S]*mysqlCatalog\.listCourses\(200\)/);
});

test('a collection officer\'s leads are the ones handed to them and the ones behind their clients', () => {
  const { leadScope } = require('../lib/leadAccess');
  const scope = leadScope({ tenantId: 't1', staffRecord: { id: 'st-9', role: 'COLLECTION' }, isSuperAdmin: false }, 'l');
  assert.equal(scope.scope, 'assigned_cs');
  assert.match(scope.sql, /l\.assigned_cs_id=\? OR l\.id IN \(SELECT lead_id FROM subscribers/);
  assert.deepEqual(scope.params, ['st-9', 't1', 'st-9']);
  const staffLeads = read('api/routes/admin/stafflists.js');
  assert.doesNotMatch(staffLeads, /noLeadsRoles = new Set\(\['collection'/);
  assert.match(staffLeads, /else if \(scope === 'assigned_cs'\) \{\s*if \(!staffId\)/);
});

test('a lead handed to collection leaves the pool a sales distribution draws from', { skip: !pools }, () => {
  const lead = { hidden: false, assignedSalesId: null, assignedCsId: null, source: 'فيسبوك', status: 'new', branch: 'ONLINE_EGYPT' };
  assert.equal(pools.isLocalNewLead(lead), true);
  assert.equal(pools.isLocalNewLead({ ...lead, assignedCsId: 'st-9' }), false);
  for (const rel of ['api/routes/admin/leads.js', 'api/routes/crm-advanced.js', 'api/routes/lead-capture-crm.js']) {
    assert.match(sourceOf(rel), /assigned_cs_id IS NULL OR (l\.)?assigned_cs_id ?= ?''/, rel);
  }
});

test('collection works leads like a rep: the sales view, their own leads, a lead of their own', () => {
  assert.match(read('admin/pages/dashboard/tabs/LeadsTab.tsx'),
    /const isSalesOnly = \['sales', 'collection'\]\.includes\(/);
  const { ROLE_PERMS } = require('../constants/permissions');
  assert.ok(ROLE_PERMS.collection.includes('manage_leads'));
  const leads = leadsRouteSource();
  // Created by collection: theirs, never auto-assigned to sales.
  assert.match(leads, /writeScope\.scope === 'assigned_cs' && staffRole !== 'collection'/);
  assert.match(leads, /if \(isNew\) \{ csId = req\.staffRecord\.id;/);
  assert.match(leads, /else if \(isNew && !salesId && !csId && !skipAutoAssign\)/);
  assert.match(leads, /assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name, crm_json/);
  // The desk's tools refuse the role by name.
  assert.equal((leads.match(/\['sales', 'collection'\]\.includes\(String\(req\.staffRecord\?\.role/g) || []).length, 2);
});

test('the remaining data goes to a collection officer in one request, into the column their scope reads', () => {
  const leads = leadsRouteSource();
  const route = leads.slice(leads.indexOf("router.post('/api/admin/leads/assign-collection'"), leads.indexOf("router.post('/api/admin/leads/bulk-whatsapp'"));
  assert.match(route, /UPPER\(role\)='COLLECTION'/);
  assert.match(route, /AND \(\(l\.assigned_sales_id IS NULL OR l\.assigned_sales_id=''\)\s*AND \(l\.assigned_cs_id IS NULL OR l\.assigned_cs_id=''\) OR l\.hidden=1 OR l\.status='archived'\)/);
  // A hidden or archived lead handed out comes back into play.
  assert.match(route, /hidden=0,\s*status=IF\(status IN \(\?\), 'new', status\)/);
  assert.match(leadsRouteSource(), /const BACK_IN_PLAY = \['archived', 'not_interested_hidden'\];/);
  assert.match(route, /UPDATE leads SET assigned_cs_id=\?, assigned_cs_name=\?/);
  const archive = read('admin/pages/dashboard/tabs/leads/ArchiveTab.tsx');
  assert.match(archive, /adminPost<\{ assigned: number; skipped: number \}>\('\/admin\/leads\/assign-collection'/);
  assert.doesNotMatch(archive, /assignedCollectionId: staff\.id/);
});

test('a collection account\'s new customer is a request until the manager approves it against a transfer', () => {
  const route = read('api/routes/subscriber-payments.js');
  assert.match(route, /const canApprovePayment = !reviewedByManager\(req\) && Boolean\(/);
  assert.match(route, /if \(reviewedByManager\(req\) && \(createFromLead \|\| createFromDraft\)\) \{/);
  const intercept = route.slice(route.indexOf('if (reviewedByManager(req) && (createFromLead'), route.indexOf('// ── Begin atomic transaction'));
  assert.match(intercept, /INSERT INTO subscriber_requests/);
  assert.match(intercept, /res\.status\(202\)/);
  assert.doesNotMatch(intercept, /INSERT INTO subscribers|INSERT INTO payments/);
  // Approval: the same booking, the request closed in its transaction.
  assert.match(route, /UPDATE subscriber_requests SET status='approved'[\s\S]{0,300}WHERE tenant_id=\? AND id=\? AND status='pending'/);
  assert.match(route, /if \(req\.linkTransfer\) await linkTransfer\(conn, \{/);
  assert.match(route, /code: 'TRANSFER_REQUIRED'/);
  // Nor can a customer be made another way from a collection account.
  assert.match(read('api/routes/admin/subscribers.js'), /if \(staffRole === 'collection' && !req\.isSuperAdmin\) \{/);
  assert.match(leadsRouteSource(), /code: 'COLLECTION_BOOKING_REQUIRED'/);
  assert.match(read('api/routes/registrations.js'), /code: 'COLLECTION_BOOKING_REQUIRED'/);
});

test('approving money: not by collection, not by whoever recorded it, and a collection booking needs its transfer', () => {
  const status = read('api/routes/core/financepay.js');
  assert.match(status, /approverRole === 'collection'/);
  assert.match(status, /code: 'PAYMENT_SELF_APPROVAL'/);
  assert.match(status, /String\(recorder\?\.role \|\| ''\)\.toLowerCase\(\) === 'collection' && !transfer && !isCashMethod\(settledMethod\)/);
  const migration = read('api/migrations/224_v26_reviewed_bookings.sql');
  assert.match(migration, /UNIQUE KEY uq_incoming_transfer_payment \(tenant_id, payment_id\)/);
  assert.match(migration, /UNIQUE KEY uq_incoming_transfer_ref \(tenant_id, method, reference\)/);
});

test('a transfer confirms one payment, and a cash box needs none', async () => {
  const { isCashMethod, linkTransfer, cleanTransfer } = require('../lib/incomingTransfers');
  assert.equal(isCashMethod('نقدي'), true);
  assert.equal(isCashMethod('خزنة الدقي'), true);
  assert.equal(isCashMethod('فودافون كاش 2020'), false);
  // The rule lost its \s once to a shell: « cash » and «كاش» were not cash.
  assert.equal(isCashMethod(' cash '), true);
  assert.equal(isCashMethod('كاش'), true);
  assert.equal(isCashMethod('cashback wallet'), false);
  assert.throws(() => cleanTransfer({ amount: 100, method: 'انستا باي', reference: '' }), /رقم العملية/);
  const fakeConn = row => ({
    calls: [],
    // The transfer row is read whole now: a bigger one is split against the payment (migration 266).
    async query(sql, params) {
      this.calls.push(sql);
      if (/SELECT \* FROM incoming_transfers WHERE tenant_id=\? AND id=\?/.test(sql)) return [[row]];
      if (/^\s*SELECT/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    },
  });
  const taken = fakeConn({ id: 't1', payment_id: 'p-other' });
  await assert.rejects(linkTransfer(taken, { tenantId: 'x', paymentId: 'p1', link: { transferId: 't1' } }), /متربط بدفعة تانية/);
  const free = fakeConn({ id: 't1', payment_id: null });
  assert.equal(await linkTransfer(free, { tenantId: 'x', paymentId: 'p1', link: { transferId: 't1' } }), 't1');
  assert.ok(free.calls.some(sql => /UPDATE payments SET linked_transfer_id=\?/.test(sql)));
});

test('the accounts screen stays with admin, accountant, online manager and customer service; everyone else gets «مدفوعاتي»', () => {
  const tabs = read('admin/pages/dashboard/DashboardFinanceTabs.tsx');
  // Customer service answers callers about any payment (owner, «اظهرلها صفحه المدفوعات»).
  assert.match(tabs, /props\.isAdmin \|\| props\.isOnlineManager\n  \|\| \['accountant', 'support'\]\.includes\(String\(props\.currentStaff\?\.role \|\| ''\)\.toLowerCase\(\)\)/);
  assert.match(tabs, /<StaffPaymentsTab/);
  const page = read('admin/pages/dashboard/tabs/staff-payments/StaffPaymentsTab.tsx');
  // A track's payment is named by the track.
  assert.match(page, /if \(key\.startsWith\('bundle:'\)\) return bundles\.find/);
  assert.match(page, /<StaffRefundsSection /);
  // The collection bar has no separate refunds tab any more.
  const nav = read('admin/pages/dashboard/DashboardNavigation.tsx');
  const collectionBar = nav.slice(nav.indexOf('{isCollectionRole && ('), nav.indexOf('Reception Daqqi horizontal nav'));
  assert.doesNotMatch(collectionBar, /refund_requests/);
});

test('employee requests: hours on a permission, the HR inbox, and payroll excusing an approved morning one', () => {
  const selfService = read('api/routes/hr/compensation.js');
  assert.match(selfService, /\(id,tenant_id,policy_id,staff_id,type,start_date,end_date,start_time,end_time,total_days,reason,status\)/);
  assert.match(selfService, /router\.put\('\/api\/staff\/me\/leaves\/:id\/cancel'/);
  assert.match(selfService, /createNotification\('hr', `طلب /);
  const approval = read('api/routes/hr/attendance.js');
  assert.match(approval, /if \(status === 'APPROVED' && !HOUR_PERMITS\.has\(leave\.type\)\) \{/);
  assert.match(read('api/routes/hr/payroll.js'), /lp\.type='LATE_PERMIT' AND lp\.status='APPROVED'/);
  assert.match(read('api/routes/hr/records.js'), /createNotification\('hr', 'طلب سلفة'/);
  const hrTab = read('admin/pages/dashboard/tabs/HRTab.tsx');
  // «خلي الاساسي لما افتح هو دليل الموظفين … الاجازات مع طلبات الموظفين» (5 Oct
  // 2026): the directory opens first, and the requests share a tab with the leaves.
  assert.match(hrTab, /\['requests', 'الطلبات والإجازات', Inbox\]/);
  assert.match(hrTab, /const HR_SECTIONS = \['directory', 'requests'/);
  assert.match(hrTab, /SECTION_ALIASES\[param \|\| ''\] \|\| 'directory'/);
  assert.match(hrTab, /<HrRequestsInbox[\s\S]{0,500}<HrLeavesPanel/);
  assert.match(read('api/migrations/223_v26_permission_times.sql'), /ADD COLUMN IF NOT EXISTS start_time varchar\(5\)/);
});

// «زر حجز - دفعة في الاسفل دا لازم يكون ظاهر لكل الحسابات». It was hidden
// from accounts the server would refuse; every role now holds manage_payments,
// so the button is on every account and its save is never refused.
test('booking is on every account, and every account may record it', () => {
  assert.match(read('admin/pages/Dashboard.tsx'), /\n      <Suspense fallback=\{null\}>\s*<DashboardQuickBooking/);
  const { ROLE_PERMS } = require('../constants/permissions');
  for (const [role, perms] of Object.entries(ROLE_PERMS)) {
    assert.ok(perms === '*' || perms.includes('manage_payments'), `${role} cannot record the booking it is offered`);
  }
});
