'use strict';

// Everything a sales account hit in one sitting. Each of these was a tab that
// opened onto a refusal, a control that did nothing, or a list that hid the
// rows it exists to show.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

test('«إحصائياتي» points at a tab the rep can actually open', () => {
  const nav = codeOnly(read('admin/pages/dashboard/DashboardNavigation.tsx'));
  const gates = codeOnly(read('admin/pages/dashboard/dashboardShared.tsx'));
  const { ROLE_PERMS } = require('../constants/permissions');

  // It used to point at `overview`, which is gated on view_financial — a
  // permission neither of them held, so their own statistics answered
  // «غير مصرح بالوصول».
  //
  // The two bars differ now because the roles do, and that is the point: sales
  // holds view_leads and reaches staff_performance; collection holds
  // view_financial and keeps overview, which opens for them. Widening the
  // staff_performance gate to cover both would have put the tab in the HR
  // sidebar pointing at a 403 — HR holds view_reports and not view_leads — the
  // same menu-gate-vs-API-gate mismatch menuGateMatchesApi.test.js exists for.
  assert.match(nav, /\{ key: 'staff_performance', label: 'إحصائياتي'/);

  const gate = /staff_performance:\s*(\[[^\]]*\]|'\w+')/.exec(gates);
  assert.ok(gate, 'staff_performance has no permission mapping');
  const opens = [...gate[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  assert.ok(opens.some(p => ROLE_PERMS.sales.includes(p)),
    `a rep cannot open their own «إحصائياتي» — it needs one of ${opens.join(', ')}`);
  // HR reaches it too now, and its API was widened to view_hr with it — the
  // mismatch this used to guard against is closed on both sides rather than by
  // keeping the screen away from the section it belongs to.
  assert.ok(opens.includes('view_hr'), 'the HR section lost its own performance board');
  assert.match(read('api/routes/admin/leads.js'),
    /staff-performance', requireAuth, requireAdminOrStaff, requireAnyPermission\('view_leads', 'view_hr'\)/,
    'the menu offers HR a screen its API refuses');

  // Whichever tab a bar names, the role reading that bar must be able to open it.
  assert.ok(ROLE_PERMS.collection.includes('view_financial'),
    'the collection bar points at overview, which needs view_financial');
});

test('an employee looking at their own statistics sees only their own row', () => {
  const tab = codeOnly(read('admin/pages/dashboard/tabs/StaffPerformanceTab.tsx'));
  // The rows come from the staff list, not from the server aggregate, so
  // without this a rep saw every colleague listed at zero — a roster they
  // should not have and numbers that are not true.
  assert.match(tab, /const selfOnly = !isAdmin && Boolean\(myStaffId\)/);
  assert.match(tab, /selfOnly \? s\.id === myStaffId :/);
  // And the screen says which of its two jobs it is doing.
  assert.match(tab, /selfOnly \? 'إحصائياتي' : 'أداء فريق العمل'/);
});

test('a rep can register the payment they just closed', () => {
  const { ROLE_PERMS } = require('../constants/permissions');
  assert.ok(ROLE_PERMS.sales.includes('manage_payments'),
    'booking a client still fails with "Permission denied: manage_payments"');

  // The route the booking modal reaches.
  const route = codeOnly(read('api/routes/subscriber-payments.js'));
  assert.match(route, /requirePermission\('manage_payments'\)/);
  // And what keeps that safe: a rep cannot approve their own money.
  assert.match(route, /hasPermission\(req\.staffRecord, 'manage_financial'\)/);
  assert.match(route, /requestedStatus === 'paid' && !canApprovePayment \? 'pending' : requestedStatus/);
  assert.match(
    codeOnly(read('api/routes/orders.js')),
    /The employee who recorded an order cannot approve its payment/
  );
});

test('«ملفي» is one page for every account, and the old addresses still land on it', () => {
  const tabs = codeOnly(read('admin/pages/dashboard/my-profile/profileTabs.ts'));
  const page = codeOnly(read('admin/pages/dashboard/my-profile/MyProfilePage.tsx'));
  const dashboard = codeOnly(read('admin/pages/Dashboard.tsx'));

  // «خلي الملف الشخصي والملف الوظيفي صفحه واحدة ... وبداخلها تابات مختلفه»:
  // both keys open the one page, and my_hr opens it on the job file.
  assert.match(tabs, /export const PROFILE_TABS = \['staff_home', 'staff_settings', 'my_hr'\] as const;/);
  assert.match(page, /useState<Section>\(activeTab === 'my_hr' \? 'job'/);
  assert.match(dashboard, /\{isProfileTab\(activeTab\) && currentStaff && \(/);
  assert.match(dashboard, /<MyProfilePage/);
  assert.ok(!/DashboardMyHr|DashboardMyWorkspace/.test(dashboard), 'the two old pages still render');
  assert.match(dashboard, /navigate\(`\/dashboard\/\$\{urlForTab\(tab\)\}`\)/);
  // And reachable: it is the employee's own file, so it names no permission at
  // all. It used to ask for view_dashboard, which an employee whose grid had
  // been narrowed to lead work does not hold — their own file answered
  // «غير مصرح بالوصول».
  assert.match(codeOnly(read('admin/pages/dashboard/dashboardShared.tsx')), /my_hr:\s*null/);
});

test('the personal page owns one heading and one tab bar, and every bar opens it from one icon', () => {
  const page = codeOnly(read('admin/pages/dashboard/my-profile/MyProfilePage.tsx'));
  // One set of chrome: «شغل النهاردة» is a tab of the page with its own header
  // off, not a second page stacked under the first («صفحتين ركبوا علي بعض»).
  assert.match(page, /<StaffHomeTab [\s\S]{0,300}?hideHeader \/>/);
  for (const tab of ['طلباتي', 'ملفي الوظيفي', 'مراسلاتي', 'الإعدادات']) assert.ok(page.includes(`label: '${tab}'`), tab);
  // «خليها ايقونه صغيره بمتثل الملف الشخصي علي الشمال زي الموجود في حساب
  // خلود ويبقي كل الحسابات بنفس الايقونات»: the role bars lost their two text
  // tabs and every bar — the admin's and each role's — draws the same icon.
  const nav = codeOnly(read('admin/pages/dashboard/DashboardNavigation.tsx'));
  assert.ok(!nav.includes("label: 'مساحتي'") && !nav.includes('title="مساحتي'), 'the bars still say مساحتي');
  assert.ok(!/\{ key: '(staff_home|my_hr)', label:/.test(nav), 'a role bar still has the profile as text tabs');
  assert.match(nav, /title="ملفي" aria-label="ملفي"/);
  assert.equal((nav.match(/<ProfileIconButton /g) || []).length, 2, 'the admin bar and the role bar each draw the icon once');
});

test('the online screen holds online clients, and says which market each is in', () => {
  // «سواء اونلاين محلي او دولي او سعودي دول فقط اللى بيظهروا» (28 Sep): it
  // listed every branch, so its total was more than its markets added up to.
  // A Daqqi client is on the Daqqi desk, and every client of every branch is in
  // «قاعدة العملاء», so a rep still finds whoever they signed up.
  const tab = codeOnly(read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx'));
  assert.match(tab, /: branchScopedMasterList\.filter\(isOnlineClient\);/);
  assert.match(tab, /branch: true,/, 'the market column is not switched on');

  const table = codeOnly(read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx'));
  assert.match(table, /vc\.branch && <th/);
  assert.match(table, /vc\.branch && <td[^\n]*\{placeLabel\(row\)\}/);
  assert.match(table, /isOnlineClient\(row\) \? MARKET_LABELS\[subscriberMarket\(row\)\] : branchLabel\(row\.branch\)/);
});

test('عملائي has its own URL, and the old ones still land', () => {
  const aliases = read('admin/pages/dashboard/tabUrlAliases.ts');
  assert.match(aliases, /online_clients: 'my_clients'/);
  assert.match(aliases, /my_clients: 'online_clients'/);
  // The spelling that has been in bookmarks and notification links.
  assert.match(aliases, /subscribers: 'online_clients'/);
});

test('محلي قديم and دولي get the same filters as the table view', () => {
  const leads = codeOnly(read('admin/pages/dashboard/tabs/LeadsTab.tsx'));
  // The bar was hidden on those sub-tabs entirely.
  assert.match(leads, /visible=\{subTab === 'pipeline' \|\| subTab === 'table' \|\| \['archive', 'dawliOld', 'localNew'\]\.includes\(subTab\)\}/);
  assert.match(leads, /matchesFilters=\{matchesFilters\}/);

  // And the rows honour it, on top of each view's own source filter.
  const archive = codeOnly(read('admin/pages/dashboard/tabs/leads/ArchiveTab.tsx'));
  assert.match(archive, /\.filter\(l => \(matchesFilters \? matchesFilters\(l\) : true\)\)/);

  // One predicate, not a second copy that can drift.
  const hook = codeOnly(read('admin/pages/dashboard/tabs/leads/useLeadFilteringData.ts'));
  assert.match(hook, /const matchesFilters = useCallback/);
  // \s, not \n: the hook file has Windows line endings.
  assert.match(hook, /matchesFilters\(lead\)\s*\)\s*,\s*\[effectiveLeads, showHiddenLeads, isSalesOnly, matchesFilters\]\)/);
  assert.match(hook, /matchesFilters \};/);
});

test('granting a permission that cannot return a row says so', () => {
  const panel = codeOnly(read('admin/pages/staff-profile/StaffSettingsPanel.tsx'));
  // role 'hr' carries scope 'none', so the sales and online permissions open
  // tabs onto empty screens with nothing to explain why.
  const { DATA_SCOPE } = require('../constants/permissions');
  assert.equal(DATA_SCOPE.hr, 'none');
  assert.match(panel, /الصلاحيات دي مش هتعرض أي بيانات/);
  assert.match(panel, /effectiveScope !== 'none'/);
});
