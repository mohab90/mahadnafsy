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
  .map(line => line.replace(/(^|\s)\/\/.*$/, '$1'))
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

  const gate = /staff_performance:\s*'(\w+)'/.exec(gates);
  assert.ok(gate, 'staff_performance has no permission mapping');
  assert.ok(ROLE_PERMS.sales.includes(gate[1]),
    `a rep cannot open their own «إحصائياتي» — it needs ${gate[1]}`);
  assert.ok(!ROLE_PERMS.hr.includes(gate[1]),
    'HR would get this tab in its sidebar pointing at a 403');

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

test('ملفي الوظيفي is its own tab with its own URL', () => {
  const workspace = codeOnly(read('admin/pages/dashboard/DashboardMyWorkspace.tsx'));
  const dashboard = codeOnly(read('admin/pages/Dashboard.tsx'));

  // الرئيسية and ملفي الشخصي are one page; my_hr is not part of it any more.
  assert.match(workspace, /export const WORKSPACE_TABS = \['staff_home', 'staff_settings'\] as const;/);
  assert.ok(!/'my_hr'/.test(workspace.slice(workspace.indexOf('WORKSPACE_TABS'), workspace.indexOf('WORKSPACE_TABS') + 200)),
    'my_hr is still a section inside the personal page');
  // It renders on its own, and setActiveTab pushes /dashboard/<tab>.
  assert.match(dashboard, /activeTab === 'my_hr' && currentStaff && <DashboardMyHr/);
  assert.match(dashboard, /navigate\(`\/dashboard\/\$\{urlForTab\(tab\)\}`\)/);
  // Which means it is reachable by permission too.
  assert.match(codeOnly(read('admin/pages/dashboard/dashboardShared.tsx')), /my_hr:\s*'view_dashboard'/);
});

test('the personal page is one page, not a sub-nav', () => {
  const workspace = codeOnly(read('admin/pages/dashboard/DashboardMyWorkspace.tsx'));
  // Both panels render together rather than behind a section switcher.
  assert.match(workspace, /<StaffHomeTab \{\.\.\.\(staffHomeProps as any\)\} \/>/);
  assert.match(workspace, /<DashboardStaffSettingsPanel \{\.\.\.\(staffSettingsProps as any\)\} \/>/);
  assert.ok(!workspace.includes('const SECTIONS'), 'the three-section nav bar is still there');
  // And the role bars call it what it is.
  const nav = codeOnly(read('admin/pages/dashboard/DashboardNavigation.tsx'));
  assert.ok(!nav.includes("label: 'مساحتي'"), 'the bars still say مساحتي');
  assert.match(nav, /\{ key: 'staff_home', label: 'ملفي الشخصي'/);
  assert.match(nav, /\{ key: 'my_hr', label: 'ملفي الوظيفي'/);
});

test('عملائي holds every branch, and says which', () => {
  const tab = codeOnly(read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx'));
  // It used to drop every Daqqi client outright, so a rep who signed one up
  // could not find them anywhere on their own screen.
  assert.ok(!tab.includes("branchScopedMasterList.filter(s => normBranchId(s.branch) !== 'DAQQI')"),
    'عملائي still excludes Daqqi clients');
  assert.match(tab, /const \[clientBranchFilter, setClientBranchFilter\] = useState\(''\)/);
  assert.match(tab, /branch: true,/, 'the branch column is not switched on');

  const table = codeOnly(read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx'));
  assert.match(table, /vc\.branch && <th/);
  assert.match(table, /vc\.branch && <td/);
  const toolbar = codeOnly(read('admin/pages/dashboard/tabs/online-clients-sections/FiltersToolbar.tsx'));
  assert.match(toolbar, /clientBranchFilter/);
  assert.match(toolbar, /كل الفروع/);
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
