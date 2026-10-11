'use strict';

// «السيستم تقيل في الفتح»: measured on 11 Oct 2026 against the local copy of
// production, opening the admin made 40 requests and pulled 1,598,631 bytes
// before anyone clicked — the 500 newest clients (842 KB), leads (350 KB) and
// orders (277 KB) among them, for a landing screen that counts all three from
// the database. After: 27 requests, 47,628 bytes.
//
// Those lists come when a screen reads them now (admin siteLists.ts). The way
// that goes wrong is silent: a screen that reads a list nobody loaded does not
// fail, it draws an empty array as "none". So the test is not "the fetch moved"
// — it is "every reader is covered": a tab nobody has read through gets every
// list; a tab that has been read through declares its lists, and its imports
// are walked for anything it forgot; a page outside the tabs asks for its own.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1')).join('\n');

// The real modules with their types stripped, not copies of their rules.
function loadLists() {
  const strip = rel => require('node:module').stripTypeScriptTypes(read(rel))
    .replace(/^import .*$/gm, '').replace(/^export /gm, '');
  const js = strip('admin/context/site-data-hooks/siteLists.ts') + strip('admin/pages/dashboard/tabSiteLists.ts');
  const box = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', js + '\nmodule.exports = { SITE_LISTS, SITE_LIST_KEYS, listOfKey, tabSiteLists, listsForTab };')(box);
  return box.exports;
}
const { SITE_LISTS, SITE_LIST_KEYS, listOfKey, tabSiteLists, listsForTab } = loadLists();

/** The context keys a module reads from any of the site-data hooks. */
function contextKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(/\{([^{}]*)\}\s*=\s*use(?:SiteData|CrmData|FinanceData|StaticData)\(\)/g)) {
    for (const part of match[1].split(',')) {
      const name = part.split(':')[0].trim();
      if (name) keys.add(name);
    }
  }
  return keys;
}
/** The lists a module asks for with useEnsureSiteLists([...]). */
function askedLists(source) {
  const asked = new Set();
  for (const match of source.matchAll(/useEnsureSiteLists\(\[([^\]]*)\]/g)) {
    for (const name of match[1].matchAll(/'([A-Za-z]+)'/g)) asked.add(name[1]);
  }
  return asked;
}
/** The lists a module reads, by the keys it pulls from the context. */
const listsRead = source => new Set([...contextKeys(source)].map(listOfKey).filter(Boolean));

/** Static, non-type imports, followed through admin/ (dynamic import() is a chunk opened later, not this screen). */
function closure(entry) {
  const seen = new Set();
  const stack = [path.join(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = codeOnly(fs.readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) {
      const base = path.resolve(path.dirname(file), match[1]);
      const found = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
        .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (found && found.startsWith(path.join(ROOT, 'admin'))) stack.push(found);
    }
  }
  return [...seen].map(file => path.relative(ROOT, file).split(path.sep).join('/'));
}

test('a screen nobody has read through gets every list, as it had before', () => {
  assert.deepEqual([...listsForTab('online_clients')], [...SITE_LISTS]);
  assert.deepEqual([...listsForTab('no_such_screen')], [...SITE_LISTS]);
  assert.deepEqual([...listsForTab('overview')], []);
  // Every list fills a context key, and no key belongs to two lists.
  const keys = SITE_LISTS.flatMap(list => SITE_LIST_KEYS[list]);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(listOfKey('fbLeadAdsConfig'), 'settings');
  assert.equal(listOfKey('courses'), null, 'the catalogue still comes with the panel');
});

test('the sign-in loads none of the on-demand lists, and every one has a loader', () => {
  const runtime = codeOnly(read('admin/context/site-data-hooks/useAdminDataRuntime.ts'));
  const boot = runtime.slice(runtime.indexOf('void (async () => {'), runtime.indexOf('const fetchList = useCallback'));
  for (const call of ['listSubscribersPage(', 'listLeadsPage(', 'listAllOrders(', 'listActivityLogs(', 'listAllExpenses(',
    'listAllJoinUs(', 'listAllContactMessages(', 'listAllDaqqiRounds(', 'listAllAutomationWorkflows(', 'getDiscounts(',
    'getSettings(', 'listTestimonials(', 'listQuizzes(', 'listLiveStreams(']) {
    assert.ok(!boot.includes(call), `the sign-in fetches ${call}) again, for every screen`);
  }
  // What the landing screen and every screen's chrome draw from still comes.
  for (const call of ['listAllStaff(', 'listAllConsultations(', 'getContent(', 'listAllCourses(', 'getNotificationSettings(']) {
    assert.ok(boot.includes(call), `${call}) left the sign-in`);
  }
  const loader = runtime.slice(runtime.indexOf('const fetchList = useCallback'), runtime.indexOf('const ensureSiteLists'));
  for (const list of SITE_LISTS) assert.ok(loader.includes(`case '${list}':`), `no loader for ${list}`);
  // A failure is forgotten, so the next screen tries again.
  assert.ok(runtime.includes('listLoadsRef.current.delete(list)'));
  // The poll refreshes only what a screen asked for.
  assert.ok(runtime.includes("asked('leads') ? mysqlAdmin.listLeadsPage(500, 0) : nothing"));
});

test('the dashboard asks for the lists of the tab on screen', () => {
  const dashboard = codeOnly(read('admin/pages/Dashboard.tsx'));
  assert.ok(dashboard.includes('void ensureSiteLists(listsForTab(activeTab));'));
  assert.ok(dashboard.includes('void ensureSiteLists(overlayLists);'), 'the popups drawn over every screen ask too');
});

// The files each listed tab draws, from its container's call site.
const TAB_ENTRIES = {
  overview: 'admin/pages/dashboard/tabs/OverviewTab.tsx',
  management_reports: 'admin/pages/dashboard/tabs/ManagementReportsTab.tsx',
  kpi_dashboard: 'admin/pages/dashboard/tabs/KpiDashboardTab.tsx',
  consultations: 'admin/pages/dashboard/tabs/ConsultationsTab.tsx',
};

test('a tab that declares its lists reads no other from the context', () => {
  assert.deepEqual(Object.keys(tabSiteLists).sort(), Object.keys(TAB_ENTRIES).sort(),
    'a tab added to tabSiteLists.ts needs its entry file here, so its imports can be walked');
  for (const [tab, entry] of Object.entries(TAB_ENTRIES)) {
    const declared = new Set(tabSiteLists[tab]);
    const files = closure(entry).filter(file => !file.startsWith('admin/context/'));
    assert.ok(files.includes(entry));
    for (const file of files) {
      const source = codeOnly(read(file));
      const asked = askedLists(source);
      const missing = [...listsRead(source)].filter(list => !declared.has(list) && !asked.has(list));
      assert.deepEqual(missing, [], `${tab}: ${file} reads ${missing.join(', ')}, which the tab does not load`);
    }
  }
});

test('the overview no longer counts the arrays it is not given', () => {
  const overview = codeOnly(read('admin/pages/dashboard/tabs/OverviewTab.tsx'));
  // Its cards fetch their lists; its figures come from the aggregates.
  assert.ok(overview.includes("useSubscriberStats(true)"));
  assert.ok(overview.includes('sourcesFromStats(leadStats.bySource)'));
  assert.ok(!/rows: subscribers\.slice\(0, 50\)/.test(overview));
  assert.ok(!/rows: leads\.slice\(0, 50\)/.test(overview));
  // «التقارير التفصيلية» counts the arrays, so it is opened, and asks for them.
  assert.ok(overview.includes('showDetailedReports ?'));
  const analytics = codeOnly(read('admin/pages/dashboard/tabs/AnalyticsTab.tsx'));
  const missing = [...listsRead(analytics)].filter(list => !askedLists(analytics).has(list));
  assert.deepEqual(missing, [], `AnalyticsTab reads ${missing.join(', ')} without asking`);
});

test('a page outside the tabs asks for every list it reads', () => {
  const outside = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      if (entry.isDirectory()) { if (!['admin/context', 'admin/pages/dashboard'].includes(rel)) walk(rel); }
      // Dashboard.tsx asks per tab — the test above.
      else if (/\.tsx?$/.test(entry.name) && rel !== 'admin/pages/Dashboard.tsx') outside.push(rel);
    }
  };
  walk('admin');
  assert.ok(outside.length > 50, `expected the admin tree, saw ${outside.length}`);
  const readers = [];
  for (const rel of outside) {
    const source = codeOnly(read(rel));
    const lists = listsRead(source);
    if (!lists.size) continue;
    readers.push(rel);
    const missing = [...lists].filter(list => !askedLists(source).has(list));
    assert.deepEqual(missing, [], `${rel} reads ${missing.join(', ')} but never asks for it, so it sees an empty list`);
  }
  // The premise: there are readers to check.
  for (const rel of ['admin/pages/StaffProfile.tsx', 'admin/pages/ClientProfile.tsx', 'admin/pages/UnifiedClientPage.tsx', 'admin/components/PaymentModal.tsx']) {
    assert.ok(readers.includes(rel), `${rel} no longer reads a list — update this test`);
  }
});
