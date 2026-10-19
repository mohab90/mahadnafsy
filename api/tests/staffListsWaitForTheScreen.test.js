'use strict';

// «تحميل كل الليدز والعملاء للموظف عند فتح اللوحة (غير الأدمن): لسه تحميل كامل واحد في كل جلسة. ده أكبر سبب لبطء
// الموظفين، وعلاجه إن الشاشات تقرا من السيرفر بالصفحات» (18 Oct 2026).
//
// A sales rep's panel downloaded every lead and every client in their scope (37,000 leads and 5,000 clients with
// their payments, on the production-scale lab) at sign-in, after every write, every two minutes and at every return
// to the tab. The landing page, the performance page and «مدفوعاتي» read the server's own figures now, so the
// download waits for the first screen that reads the lists.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function bundle(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node',
    logLevel: 'silent', nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

test('the screens that page from the server are named, and an employee\'s panel downloads no list of clients or leads', () => {
  const lib = bundle('admin/pages/dashboard/staffListTabs.ts');
  if (lib) {
    const { staffScreenPagesFromServer: pages, staffClientsArePaged: paged, staffSkipsSiteLists: skips } = lib;
    for (const tab of ['staff_home', 'staff_settings', 'my_hr', 'leads', 'online_clients', 'orders', 'daqqi_schedule']) assert.equal(pages(tab), true, tab);
    // The screens that read the context's lists keep their reload after a write.
    for (const tab of ['client', 'refund_requests', 'daqqi_clients', 'financial']) assert.equal(pages(tab), false, tab);
    assert.equal(paged('online_clients', true, false), true);
    assert.equal(paged('online_clients', false, true), true, 'the online manager');
    assert.equal(paged('online_clients', false, false), false, 'the administration keeps the whole list');
    assert.equal(paged('leads', true, false), false);
    assert.deepEqual([...skips('orders')], ['orders', 'subscribers']);
    assert.deepEqual([...skips('online_clients')], ['subscribers']);
    assert.deepEqual([...skips('financial')], []);
  }
  // What is left of the hook is the Dokki rounds, the team and the content.
  const hook = read('admin/pages/dashboard/useStaffOwnData.ts');
  assert.doesNotMatch(hook, /streamSubscribers|listStaffLeads|salesOwn(Leads|Subscribers)|wantsLists/);
  assert.match(hook, /listAllDaqqiRounds/);
  const dashboard = read('admin/pages/Dashboard.tsx');
  assert.doesNotMatch(dashboard, /salesOwn(Leads|Subscribers|Orders)|setStaffScoped(Subscribers|Leads)|staffScreenReadsLists|wantsStaffLists/);
  assert.match(dashboard, /setStaffListsWanted\(!isNonAdminStaff \|\| !staffScreenPagesFromServer\(activeTab\)\);/,
    'a write on a screen that pages from the server reloads no list');
});

test('the bell counts on the server for every employee, so it needs no list', () => {
  const badges = read('admin/pages/dashboard/useDashboardBadges.ts');
  assert.match(badges, /const staffNotifBadge = !currentStaff \? 0 : \(dueFollowups \?\? 0\);/);
  assert.doesNotMatch(badges, /salesOwnLeads/);
  const dashboard = read('admin/pages/Dashboard.tsx');
  assert.match(dashboard, /const countsOwnFollowups = !!currentStaff && masterHasPermission\(/, 'for a role that may see leads: HR is refused the count');
});

test('the pages that wait for the lists read none of them', () => {
  for (const rel of [
    'admin/pages/dashboard/tabs/StaffHomeTab.tsx',
    'admin/pages/dashboard/my-profile/MyProfilePage.tsx',
    'admin/pages/dashboard/my-profile/MyPerformanceSection.tsx',
    'admin/pages/dashboard/tabs/staff-payments/StaffPaymentsTab.tsx',
    'admin/pages/dashboard/useStaffHomeSummary.ts',
  ]) {
    const source = read(rel);
    assert.doesNotMatch(source, /salesOwn(Leads|Subscribers)|useCrmData|subscribers=\{|leads=\{/, rel);
  }
  // The online manager's badges and panels: the server's figures, no client in the browser's lists.
  for (const rel of ['admin/pages/dashboard/useDashboardBadges.ts', 'admin/pages/dashboard/DashboardOnlineManagerPanels.tsx', 'admin/pages/dashboard/useOnlineManagerSummary.ts']) {
    assert.doesNotMatch(read(rel), /salesOwn(Leads|Subscribers)|useCrmData|SubscriberItem/, rel);
  }
  assert.match(read('admin/pages/dashboard/useOnlineManagerSummary.ts'), /\/staff\/online-manager-summary/);
  assert.match(read('admin/pages/Dashboard.tsx'), /<DashboardOnlineManagerPanels[^>]*summary=\{onlineManagerSummary\}/);
  assert.match(read('admin/pages/dashboard/tabs/StaffHomeTab.tsx'), /useStaffHomeSummary\(staff\)/);
  assert.match(read('admin/pages/dashboard/my-profile/MyPerformanceSection.tsx'), /\/staff\/payments\?summary=1&limit=1/);
  const finance = read('admin/pages/dashboard/DashboardFinanceTabs.tsx');
  assert.doesNotMatch(finance, /<StaffPaymentsTab[^>]*salesOwnSubscribers/);
  assert.doesNotMatch(read('admin/pages/Dashboard.tsx'), /<MyProfilePage[^>]*(leads|subscribers)=/);
});

test('«مدفوعاتي» asks the database for the period, the status, «mine» and the search, a page at a time', () => {
  const tab = read('admin/pages/dashboard/tabs/staff-payments/StaffPaymentsTab.tsx');
  for (const key of ['from', 'status', 'mine', 'q']) assert.match(tab, new RegExp(`params\\.set\\('${key}'`), key);
  assert.match(tab, /\/staff\/payments\?\$\{query\}&limit=\$\{PAGE_SIZE\}&offset=\$\{rows\.length\}/, 'a next page');
  assert.match(tab, /\/staff\/payments\?summary=1&limit=1/, 'the headline figures never follow the filters');
  assert.match(tab, /\/staff\/payments\?status=pending&limit=100/);
  // The refund form searches the person's own clients on the server while they type.
  assert.match(tab, /\/staff\/subscribers\?limit=50&q=\$\{encodeURIComponent\(term\)\}/);
  assert.match(read('admin/pages/dashboard/tabs/financial/AddRefundModal.tsx'), /const subscribers = lookup \? found : \(clients \?\? allSubscribers\);/);
});

test('the three staff endpoints answer for the same set of clients, and the list takes a search', () => {
  const route = read('api/routes/admin/stafflists.js');
  const uses = route.match(/staffSubscriberScope\(req\)/g) || [];
  assert.ok(uses.length >= 3, 'the list, the home summary and the payments page share one scope rule');
  assert.match(route, /router\.get\('\/api\/staff\/home-summary'/);
  assert.match(route, /router\.get\('\/api\/staff\/payments', requireAuth, requireAdminOrStaff, requirePermission\('view_subscribers'\)/);
  assert.match(route, /s\.name LIKE \? OR s\.phone LIKE \? OR s\.client_code LIKE \?/);
  // The week the page counts is the one it draws: Sunday to today, in Cairo.
  assert.match(route, /addDaysToDateOnly\(today, -new Date\(`\$\{today\}T00:00:00Z`\)\.getUTCDay\(\)\)/);
});

// «الشاشات كلها تقرا من السيرفر بالصفحات» — the leads screen (18 Oct 2026). Its table and board were paged already;
// the strip above them, the follow-ups drawer, the contact search, the export and the «✓ مشترك» badge read the
// rep's whole list of leads and clients, and now each asks the server for its own figure.
const LEADS_SCREEN = [
  'admin/pages/dashboard/tabs/LeadsTab.tsx',
  'admin/pages/dashboard/tabs/LeadTable.tsx',
  'admin/pages/dashboard/tabs/leads/LeadSalesKpiStrip.tsx',
  'admin/pages/dashboard/tabs/leads/LeadSalesNotificationsPanel.tsx',
  'admin/pages/dashboard/tabs/leads/LeadModalsHost.tsx',
  'admin/pages/dashboard/tabs/leads/LeadArchiveViews.tsx',
  'admin/pages/dashboard/tabs/leads/ArchiveTab.tsx',
  'admin/pages/dashboard/tabs/leads/CrmQuotesWorkspace.tsx',
  'admin/pages/dashboard/tabs/leads/useLeadActions.ts',
  'admin/pages/dashboard/tabs/leads/useLeadEffectiveRecords.ts',
  'admin/pages/dashboard/tabs/leads/useLeadQuickCommunication.ts',
  'admin/pages/dashboard/tabs/leads/useLeadClients.ts',
];

test('the leads screen reads none of the person\'s downloaded lists', () => {
  for (const rel of LEADS_SCREEN) {
    const source = read(rel);
    assert.doesNotMatch(source, /salesOwn(Leads|Subscribers)|effectiveSubs/, rel);
  }
  // The only places the screen is handed the staff lists are gone from its container.
  const growth = read('admin/pages/dashboard/DashboardGrowthOpsTabs.tsx');
  const leadsTab = growth.slice(growth.indexOf('<LeadsTab'), growth.indexOf('</TabErrorBoundary>', growth.indexOf('<LeadsTab')));
  assert.doesNotMatch(leadsTab, /salesOwn/);
  // The booking dialog asks whether the lead already is a client, instead of searching a list of every client.
  const payments = read('admin/pages/dashboard/dashboardPaymentHandlers.ts');
  assert.match(payments, /const existingSub = await findLeadClient\(freshLead\.id\)/);
  assert.doesNotMatch(payments.slice(payments.indexOf('interface HandleLeadPaymentDeps'), payments.indexOf('export async function handleLeadPaymentFn')), /subscribers|leads:/);
  assert.match(read('admin/lib/leadClients.ts'), /\/admin\/leads\/clients\?ids=/);
});

test('each figure the leads screen used to count in the browser has an endpoint behind the lead scope', () => {
  const stafflists = read('api/routes/admin/stafflists.js');
  const kpis = stafflists.slice(stafflists.indexOf("'/api/staff/leads-kpis'"));
  assert.match(kpis, /requirePermission\('view_leads'\)/);
  assert.match(kpis, /leadScope\(req, 'l'\)/, 'the strip counts the leads the list answered with');
  assert.match(kpis, /staffSubscriberScope\(req\)/, 'and the collected money of the same clients the list answered with');
  assert.match(kpis, /ARCHIVE_SOURCE_PREFIXES/, 'the imported archive stays out of a rep\'s figures');
  assert.match(kpis, /figures:staff-leads-kpis:/, 'held 15 s and dropped by the next write like the other counters');
  assert.match(read('admin/pages/dashboard/tabs/leads/LeadSalesKpiStrip.tsx'), /adminGet<LeadKpis>\('\/staff\/leads-kpis'\)/);

  const stats = read('api/routes/admin/leads/stats.js');
  assert.match(stats.slice(stats.indexOf("'/api/admin/leads/followups-panel'")), /leadScope\(req, 'l'\)/);
  const lists = read('api/routes/admin/leads/lists.js');
  const clients = lists.slice(lists.indexOf("'/api/admin/leads/clients'"), lists.indexOf("'/api/admin/leads/board'"));
  assert.match(clients, /leadScope\(req, 'l'\)/, 'a client is named only for a lead the caller may see');
  assert.match(clients, /\.slice\(0, 100\)/);

  // The contact search and the export read the table's own endpoint, under the filters on screen.
  assert.match(read('admin/pages/dashboard/tabs/leads/useLeadQuickCommunication.ts'), /\/admin\/leads\/table\?q=/);
  assert.match(read('admin/pages/dashboard/tabs/leads/useServerLeadTable.ts'), /const exportAll = useCallback/);
  assert.match(read('admin/pages/dashboard/tabs/LeadsTab.tsx'), /fetchVisibleLeads: serverTable\.exportAll/);
});

// The screens that still read the person's own lists are named in staffListTabs.ts (READS_OWN_LISTS), so a screen that
// starts reading them cannot hide behind a gate that says it does not: the files that touch the lists are these.
function adminSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) adminSources(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('no file reads the downloaded lists of clients and leads any more', () => {
  const readers = adminSources(path.join(ROOT, 'admin'))
    .filter(file => /salesOwn(Leads|Subscribers|Orders)|staffScoped(Subscribers|Leads)/.test(fs.readFileSync(file, 'utf8')))
    .map(file => path.relative(ROOT, file).split(path.sep).join('/'))
    .sort();
  // What is left is the context's slot for «the rows on screen» that a save is compared against
  // (useCrmCoreState.updateSubscriber), which the paged clients screen fills (setStaffScopedSubscribers in OnlineClientsTab).
  assert.deepEqual(readers, [
    'admin/context/SiteDataContext.tsx',
    'admin/context/site-data-hooks/useCrmCoreState.ts',
    'admin/context/siteDataSlices.tsx',
  ].sort());
});
