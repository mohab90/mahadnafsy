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

test('the landing page and the person\'s own pages do not start the download; the screens that read the lists do', () => {
  const lib = bundle('admin/pages/dashboard/staffListTabs.ts');
  if (!lib) return;
  const { staffScreenReadsLists: reads } = lib;
  for (const tab of ['staff_home', 'staff_settings', 'my_hr']) assert.equal(reads(tab, 'sales', false), false, tab);
  assert.equal(reads('orders', 'sales', false), false, '«مدفوعاتي» pages from the server');
  assert.equal(reads('orders', 'collection', false), false);
  for (const tab of ['leads', 'online_clients', 'daqqi_clients', 'client', 'sales_hub', 'refund_requests', 'some_new_screen']) {
    assert.equal(reads(tab, 'sales', false), true, `${tab} is read through only when it is listed`);
  }
  // The accounts screen keeps the loaded clients, and so does the online manager's header (installments, new payments).
  assert.equal(reads('orders', 'accountant', false), true);
  assert.equal(reads('orders', 'support', false), true);
  assert.equal(reads('staff_home', 'sales', true), true);
});

test('the staff lists are downloaded only on a screen that wants them, and the timers leave the others alone', () => {
  const hook = read('admin/pages/dashboard/useStaffOwnData.ts');
  assert.match(hook, /const withLists = wantsListsRef\.current;/);
  assert.match(hook, /if \(withLists\) \{/, 'the clients and leads are read inside this branch only');
  // «Fresh» on a screen that reads the lists means the lists were read, not the bootstrap a list-less screen runs.
  assert.match(hook, /listsAtRef\.current = Date\.now\(\);/);
  assert.match(hook, /if \(\(runningRef\.current && runWithListsRef\.current\) \|\| Date\.now\(\) - listsAtRef\.current < maxAgeMs\)/);

  const dashboard = read('admin/pages/Dashboard.tsx');
  assert.match(dashboard, /const wantsStaffLists = staffScreenReadsLists\(activeTab, \(staffSelf \|\| currentStaff\)\?\.role, isOnlineManager\);/);
  assert.match(dashboard, /useStaffOwnData\(\{\s*wantsLists: wantsStaffLists,/);
  assert.match(dashboard, /if \(wantsStaffLists\) void fetchSalesDataIfStale\(2 \* 60 \* 1000\);/,
    'the first screen that reads the lists starts them, a return within two minutes does not');
  assert.match(dashboard, /if \(wantsStaffListsRef\.current\) void fetchSalesData\(\);/, 'a write refreshes them only where they are shown');
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
