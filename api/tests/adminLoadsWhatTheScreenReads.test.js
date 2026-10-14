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

const resolveFrom = (file, spec) => {
  const base = path.resolve(path.dirname(file), spec);
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
};
// The registries of lazy screens (lazyTabs.tsx and its sibling): importing one
// name from them draws that screen and no other, so a name is followed to its
// own file rather than the registry pulling in every screen it lists.
const LAZY_REGISTRY = /[\\/]lazy(?:Tabs|DashboardComponents)\.tsx$/;
function registryTargets(registry, names) {
  const source = codeOnly(fs.readFileSync(registry, 'utf8'));
  const targets = [];
  for (const name of names) {
    const match = source.match(new RegExp(`export const ${name} = [^\\n]*?import\\(\\s*['"](\\.[^'"]+)['"]`));
    const found = match && resolveFrom(registry, match[1]);
    if (found) targets.push(found);
  }
  return targets;
}

/**
 * Every file a screen can draw: static imports, and the sections and popups it
 * loads with lazy(() => import(...)) — a lazy section is a chunk fetched later,
 * but it is still this screen and reads what this screen loaded. Followed through
 * admin/, type imports aside.
 */
function closure(entries) {
  const seen = new Set();
  const stack = [].concat(entries).map(entry => path.join(ROOT, entry));
  const inAdmin = found => found && found.startsWith(path.join(ROOT, 'admin') + path.sep);
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = codeOnly(fs.readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/^\s*(?:import|export)\s+(?!type\b)([^'"]*?)from\s+['"](\.[^'"]+)['"]/gm)) {
      const found = resolveFrom(file, match[2]);
      if (!inAdmin(found)) continue;
      if (LAZY_REGISTRY.test(found)) stack.push(...registryTargets(found, [...match[1].matchAll(/\b([A-Z]\w*)\b/g)].map(m => m[1])));
      else stack.push(found);
    }
    if (LAZY_REGISTRY.test(file)) continue;
    for (const match of source.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const found = resolveFrom(file, match[1]);
      if (inAdmin(found)) stack.push(found);
    }
  }
  return [...seen].map(file => path.relative(ROOT, file).split(path.sep).join('/'));
}

test('a screen nobody has read through gets every list, as it had before', () => {
  assert.deepEqual([...listsForTab('no_such_screen')], [...SITE_LISTS]);
  assert.deepEqual([...listsForTab('overview')], []);
  // Read through since: the heaviest screens open on their own lists.
  assert.deepEqual([...listsForTab('online_clients')].sort(), ['daqqiRounds', 'subscribers']);
  assert.deepEqual([...listsForTab('team_inbox')], []);
  for (const tab of Object.keys(tabSiteLists)) {
    for (const list of tabSiteLists[tab]) assert.ok(SITE_LISTS.includes(list), `${tab}: no list called ${list}`);
  }
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
  // The tab on screen is the URL's, through its aliases, from the first render:
  // /dashboard/my_clients mounted as a «my_clients» screen nobody lists, and
  // fetched every list for it before the URL effect corrected it.
  assert.ok(dashboard.includes("useState<TabKey>(urlTab ? tabForUrl(urlTab) : 'overview')"));
});

// The files each listed tab draws, from its container's call site:
// Dashboard.tsx, DashboardStandaloneTabs, DashboardFinanceTabs,
// DashboardCustomerServiceTabs, DashboardGrowthOpsTabs, DashboardSaasOpsTabs,
// GeneralDashboardTabs (its notifyTabs table), DashboardContentHubRoutes and
// DashboardDirectContentRoutes.
const D = 'admin/pages/dashboard';
const T = `${D}/tabs`;
const COURSES = `${T}/CoursesTab.tsx`;
const DIRECT_CONTENT = `${D}/DashboardDirectContentRoutes.tsx`;
const PROFILE = `${D}/my-profile/MyProfilePage.tsx`;
const TAB_ENTRIES = {
  overview: `${T}/OverviewTab.tsx`,
  management_reports: `${T}/ManagementReportsTab.tsx`,
  kpi_dashboard: `${T}/KpiDashboardTab.tsx`,
  consultations: `${T}/ConsultationsTab.tsx`,
  online_clients: `${D}/DashboardClientTabs.tsx`,
  daqqi_clients: `${D}/DashboardClientTabs.tsx`,
  orders: [`${T}/OrdersTab.tsx`, `${T}/orders/CollectionBookingsReview.tsx`, `${T}/staff-payments/StaffPaymentsTab.tsx`],
  financial: `${T}/FinancialTab.tsx`,
  daqqi_accounting: `${T}/FinancialTab.tsx`,
  financial_reports: `${D}/FinancialReportsHub.tsx`,
  recurring_expenses: `${T}/RecurringExpensesTab.tsx`,
  client: `${T}/ClientDbTab.tsx`,
  refund_requests: `${T}/financial/FinancialRefundsPanel.tsx`,
  installment_plans: `${T}/InstallmentPlansTab.tsx`,
  subscriptions: `${T}/SubscriptionsTab.tsx`,
  archived_clients: `${T}/ArchivedClientsTab.tsx`,
  leads: `${T}/LeadsTab.tsx`,
  sales_hub: `${T}/SalesPerformancePage.tsx`,
  sales_team: `${T}/SalesTeamTab.tsx`,
  sales_reports: `${T}/SalesReportsTab.tsx`,
  sales_planning: `${T}/SalesPlanningTab.tsx`,
  staff_performance: `${T}/StaffPerformanceTab.tsx`,
  sales_daqqi_schedule: `${T}/SalesDaqqiScheduleTab.tsx`,
  marketing_hub: `${T}/MarketingHubTab.tsx`,
  campaigns: `${T}/CampaignsTab.tsx`,
  online_team: `${T}/OnlineTeamMgmtTab.tsx`,
  online_hub: [`${T}/reports/TeamReportPanel.tsx`, `${T}/OnlineTeamTab.tsx`],
  analytics_hub: `${T}/AnalyticsHubTab.tsx`,
  daqqi_stats: [`${T}/daqqi/DokkiWeeklyPanel.tsx`, `${T}/reports/TeamReportPanel.tsx`, `${T}/AnalyticsTab.tsx`, `${T}/DaqqiAttendanceTab.tsx`],
  ask_ai: `${T}/AskAITab.tsx`,
  automation: `${T}/AutomationTab.tsx`,
  daqqi_schedule: `${T}/DaqqiScheduleTab.tsx`,
  daqqi_team: `${T}/DaqqiTeamTab.tsx`,
  daqqi_attendance: `${T}/DaqqiAttendanceTab.tsx`,
  hr: `${T}/HRTab.tsx`,
  hr_analytics: `${T}/HrAnalyticsTab.tsx`,
  branch_hr: `${T}/BranchHrTab.tsx`,
  enps_dashboard: `${T}/EnpsDashboardTab.tsx`,
  offboarding: `${T}/OffboardingTab.tsx`,
  interviews: `${T}/InterviewsTab.tsx`,
  team_inbox: `${T}/whatsapp/TeamInboxTab.tsx`,
  whatsapp_web: `${T}/whatsapp/WhatsAppWebTab.tsx`,
  customer_inbox: `${T}/CustomerInboxTab.tsx`,
  tickets: `${T}/CustomerInboxTab.tsx`,
  ratings: `${T}/RatingsTab.tsx`,
  tasks_board: `${T}/TasksBoardTab.tsx`,
  registrations: `${T}/RegistrationsTab.tsx`,
  waitlist: `${T}/WaitlistTab.tsx`,
  course_waitlist: `${T}/CourseWaitlistTab.tsx`,
  faq_manager: `${T}/FaqManagerTab.tsx`,
  notif_inbox: `${T}/NotifInboxMgmtTab.tsx`,
  notifications: `${T}/NotificationsAdminTab.tsx`,
  cx_team: [`${T}/reports/TeamReportPanel.tsx`, `${T}/CxTeamTab.tsx`],
  consultation_calendar: `${T}/ConsultationCalendarTab.tsx`,
  service_hub: `${T}/ServiceHubTab.tsx`,
  nps_dashboard: `${T}/NpsDashboardTab.tsx`,
  contacts: `${T}/ContactsTab.tsx`,
  join_us: `${T}/JoinUsAdminTab.tsx`,
  lecturer_applications: `${T}/JoinUsAdminTab.tsx`,
  activity: `${T}/ActivityTab.tsx`,
  courses: COURSES,
  lectures: COURSES,
  instructors: COURSES,
  bundles: COURSES,
  testimonials: COURSES,
  discounts: COURSES,
  quizzes: `${T}/QuizzesTab.tsx`,
  live_streams: `${T}/LiveStreamsTab.tsx`,
  community: `${D}/DashboardCommunityAdminPanel.tsx`,
  content_hub: [`${D}/DashboardContentHubPanel.tsx`, `${D}/DashboardFooterSettingsPanel.tsx`, `${D}/DashboardHomeOfferPanel.tsx`,
    `${D}/ContentHubEditors.tsx`, `${D}/DashboardContentHubAdvancedPanel.tsx`, DIRECT_CONTENT],
  footer_settings: `${D}/DashboardFooterSettingsPanel.tsx`,
  policies: DIRECT_CONTENT,
  about_page: DIRECT_CONTENT,
  home_offer: DIRECT_CONTENT,
  institute_gallery: DIRECT_CONTENT,
  cert_pricing: DIRECT_CONTENT,
  cert_requests: DIRECT_CONTENT,
  page_courses: DIRECT_CONTENT,
  page_bundles: DIRECT_CONTENT,
  page_consultations: DIRECT_CONTENT,
  page_instructors: DIRECT_CONTENT,
  page_contact: DIRECT_CONTENT,
  page_joinus: DIRECT_CONTENT,
  page_community: DIRECT_CONTENT,
  page_course_details: DIRECT_CONTENT,
  page_bundle_details: DIRECT_CONTENT,
  page_misc: DIRECT_CONTENT,
  settings_hub: `${T}/SettingsHubTab.tsx`,
  system_settings: `${T}/SystemSettingsTab.tsx`,
  branches_settings: `${T}/BranchesSettingsTab.tsx`,
  branch_workspaces: `${T}/BranchWorkspacesTab.tsx`,
  lead_sources_settings: `${T}/LeadSourcesSettingsTab.tsx`,
  integrations: `${T}/IntegrationsTab.tsx`,
  security_center: `${T}/SecurityCenterTab.tsx`,
  staff_home: PROFILE,
  staff_settings: PROFILE,
  my_hr: PROFILE,
};

test('a tab that declares its lists reads no other from the context', () => {
  assert.deepEqual(Object.keys(tabSiteLists).sort(), Object.keys(TAB_ENTRIES).sort(),
    'a tab added to tabSiteLists.ts needs its entry file here, so its imports can be walked');
  for (const [tab, entry] of Object.entries(TAB_ENTRIES)) {
    const declared = new Set(tabSiteLists[tab]);
    const files = closure(entry).filter(file => !file.startsWith('admin/context/'));
    for (const file of [].concat(entry)) assert.ok(files.includes(file), `${tab}: ${file} is missing`);
    for (const file of files) {
      const source = codeOnly(read(file));
      const asked = askedLists(source);
      const missing = [...listsRead(source)].filter(list => !declared.has(list) && !asked.has(list));
      assert.deepEqual(missing, [], `${tab}: ${file} reads ${missing.join(', ')}, which the tab does not load`);
    }
  }
});

test('the walk follows a screen into its lazy sections, and a registry by name only', () => {
  const overview = closure(TAB_ENTRIES.overview);
  // OverviewTab imports AnalyticsTab from lazyTabs.tsx: that screen, not all eighty.
  assert.ok(overview.includes('admin/pages/dashboard/tabs/AnalyticsTab.tsx'));
  assert.ok(!overview.includes('admin/pages/dashboard/tabs/HRTab.tsx'));
  // LeadsTab draws its board, follow-ups and modals with lazy(() => import(...)).
  const leads = closure(TAB_ENTRIES.leads);
  for (const lazySection of ['LeadPipelineBoard.tsx', 'LeadModalsHost.tsx', 'LeadFollowUpsPage.tsx']) {
    assert.ok(leads.includes(`admin/pages/dashboard/tabs/leads/${lazySection}`), `the walk skipped ${lazySection}`);
  }
});

// ── What Dashboard.tsx hands a screen as props ────────────────────────────────
// A screen can read a list without touching the context: Dashboard.tsx reads it
// and passes it down — the clients to العملاء, the orders to المدفوعات, a booking
// handler that searches the loaded leads to قاعدة العملاء. Walking the screen's
// imports cannot see that, so the dashboard's own code is followed: every name
// it takes from useSiteData(), and every name computed from one of those, is
// traced to the props of the element that draws each screen.

/** Dashboard's top-level statements, each with the names it declares. */
function dashboardStatements(body) {
  const statements = [];
  let current = null;
  for (const line of body.split('\n')) {
    if (/^ {2}\S/.test(line) && !/^ {2}[}\])]/.test(line)) {
      current = { text: '', names: [], declares: /^ {2}(?:const|let)\s/.test(line) };
      statements.push(current);
    }
    if (current) current.text += `${line}\n`;
  }
  for (const statement of statements) {
    if (!statement.declares) continue;
    const head = statement.text.match(/^ {2}(?:const|let)\s+(\{[\s\S]*?\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=/);
    if (!head) continue;
    statement.names = head[1].replace(/[{}[\]]/g, '').split(',')
      .map(part => part.split(':').pop().trim()).filter(name => /^[A-Za-z_$][\w$]*$/.test(name));
    statement.rhs = statement.text.slice(statement.text.indexOf(head[0]) + head[0].length);
  }
  return statements;
}

/** name → the lists it carries, for every name in Dashboard's body. */
function dashboardTaint() {
  const source = codeOnly(read('admin/pages/Dashboard.tsx'));
  const body = source.slice(source.indexOf('const Dashboard: React.FC'));
  const taint = new Map();
  const context = body.match(/const\s*\{([^{}]*)\}\s*=\s*useSiteData\(\)/);
  assert.ok(context, 'Dashboard.tsx no longer reads useSiteData() — update this test');
  for (const part of context[1].split(',')) {
    const [key, alias] = part.split(':').map(item => item.trim());
    const list = key && listOfKey(key);
    if (list) taint.set(alias || key, new Set([list]));
  }
  const statements = dashboardStatements(body).filter(statement => statement.names.length);
  const refersTo = text => [...taint.keys()].filter(name => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text));
  for (let changed = true; changed;) {
    changed = false;
    for (const statement of statements) {
      const carried = new Set(refersTo(statement.rhs).flatMap(name => [...taint.get(name)]));
      if (!carried.size) continue;
      for (const name of statement.names) {
        const held = taint.get(name) || new Set();
        const before = taint.has(name) ? held.size : -1;
        for (const list of carried) held.add(list);
        taint.set(name, held);
        if (held.size !== before) changed = true;
      }
    }
  }
  return { body, taint, refersTo };
}

/** The props of `<Element ...>` in the dashboard's JSX: name → expression. */
function elementProps(body, element) {
  const start = body.indexOf(`<${element}\n`) === -1 ? body.indexOf(`<${element} `) : body.indexOf(`<${element}\n`);
  if (start === -1) return null;
  const props = {};
  let i = start + element.length + 1;
  while (i < body.length) {
    while (/\s/.test(body[i])) i++;
    if (body.startsWith('/>', i) || body[i] === '>') break;
    const name = body.slice(i).match(/^[A-Za-z_$][\w$]*/);
    if (!name) break;
    i += name[0].length;
    if (body[i] !== '=') { props[name[0]] = 'true'; continue; }
    i++;
    if (body[i] === '{') {
      let depth = 0;
      const from = i;
      for (; i < body.length; i++) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}' && --depth === 0) { i++; break; }
      }
      props[name[0]] = body.slice(from, i);
    } else {
      const quoted = body.slice(i).match(/^(['"])[^'"]*\1/);
      props[name[0]] = quoted ? quoted[0] : '';
      i += quoted ? quoted[0].length : 0;
    }
  }
  return props;
}

// Which screens each element draws, and — where one element serves several
// screens with different props — which screens a prop reaches.
const PROFILE_TABS = ['staff_home', 'staff_settings', 'my_hr'];
const DASHBOARD_ELEMENTS = {
  OverviewTab: { tabs: ['overview'] },
  DashboardStandaloneTabs: { tabs: ['management_reports', 'kpi_dashboard', 'daqqi_attendance', 'consultations', 'notifications', 'activity', 'quizzes', 'course_waitlist', 'live_streams'] },
  DashboardDirectContentRoutes: { tabs: ['policies', 'about_page', 'home_offer', 'institute_gallery', 'cert_pricing', 'cert_requests', 'page_courses', 'content_hub'] },
  CoursesTab: { tabs: ['courses', 'lectures', 'instructors', 'bundles', 'testimonials', 'discounts'] },
  DashboardClientTabs: { tabs: ['online_clients', 'daqqi_clients'] },
  DashboardCustomerServiceTabs: { tabs: ['refund_requests', 'contacts', 'join_us'] },
  DashboardFinanceTabs: {
    tabs: ['orders', 'financial', 'client'],
    props: { ordersProps: ['orders'], onClientBook: ['client'], branchFilter: ['orders', 'financial'] },
  },
  DashboardCommunityAdminPanel: { tabs: ['community'] },
  DashboardSaasOpsTabs: { tabs: ['ask_ai', 'automation'] },
  DashboardGrowthOpsTabs: { tabs: ['leads', 'daqqi_schedule', 'sales_hub', 'marketing_hub', 'online_hub'] },
  DashboardContentHubRoutes: { tabs: ['content_hub', 'footer_settings', 'hr', 'team_inbox', 'service_hub', 'settings_hub'] },
  MyProfilePage: { tabs: PROFILE_TABS },
};
// Drawn over every screen: each asks for its own lists (overlayLists), so the
// screen under it does not need them.
const OVERLAYS = new Set(['DashboardNavigation', 'DashboardOnlineManagerPanels', 'LeadSalesNotificationsPanel',
  'DashboardQuickBooking', 'DashboardPaymentOverlays', 'OwnerProfilePage', 'DashboardTabContainer', 'PhysicalBranchProvider']);
// A prop a screen is handed and does not read for an admin, with why.
const NOT_READ = {
  // الرئيسية counts from leads/stats, subscribers/stats and overview/revenue
  // (overviewFigures.ts); the arrays are the staff path's, and the fallback
  // before those answer.
  overview: new Set(['subscribers', 'leads', 'orders']),
};

test('every list Dashboard.tsx hands a screen is one the screen loads', () => {
  const { body, taint, refersTo } = dashboardTaint();
  // The premise: the names it computes from the lists are followed.
  for (const [name, list] of [['effectiveOrders', 'orders'], ['filteredOrders', 'subscribers'], ['handleClientDbBook', 'leads'], ['overviewStats', 'orders']]) {
    assert.ok(taint.get(name)?.has(list), `${name} should carry ${list}`);
  }
  const ret = body.slice(body.lastIndexOf('\n  return ('));
  const drawn = new Set([...ret.matchAll(/<([A-Z][\w.]*)[\s>]/g)].map(m => m[1]));
  for (const element of drawn) {
    const props = elementProps(ret, element) || {};
    const carriesAny = Object.values(props).some(expression => refersTo(expression).length);
    if (!carriesAny || OVERLAYS.has(element)) continue;
    assert.ok(DASHBOARD_ELEMENTS[element], `<${element}> is handed a list by Dashboard.tsx; name the screens it draws in DASHBOARD_ELEMENTS`);
  }
  for (const [element, { tabs, props: reach = {} }] of Object.entries(DASHBOARD_ELEMENTS)) {
    const props = elementProps(ret, element);
    assert.ok(props, `<${element}> is no longer drawn by Dashboard.tsx — update this test`);
    for (const [prop, expression] of Object.entries(props)) {
      const carried = new Set(refersTo(expression).flatMap(name => [...taint.get(name)]));
      for (const tab of reach[prop] || tabs) {
        assert.ok(tabs.includes(tab));
        const declared = new Set(tabSiteLists[tab] || SITE_LISTS);
        const missing = [...carried].filter(list => !declared.has(list) && !NOT_READ[tab]?.has(list));
        assert.deepEqual(missing, [], `${tab}: <${element} ${prop}> carries ${missing.join(', ')}, which the tab does not load`);
      }
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

// «الأدمن اللي ليه ملف موظف بيحمّل 500 ليد عشان رقم الجرس»: the bell's count
// comes from GET /admin/leads/followups-due, in the session's own scope, and
// the panel no longer loads the leads for it.
test('the follow-up bell counts on the server, not out of the 500 newest leads', () => {
  const dashboard = codeOnly(read('admin/pages/Dashboard.tsx'));
  const overlay = dashboard.slice(dashboard.indexOf('const overlayLists'), dashboard.indexOf('void ensureSiteLists(overlayLists)'));
  assert.ok(!/currentStaff\s*&&\s*!usesStaffScopedData\s*\?\s*\['leads'/.test(overlay), 'the bell loads the leads again');
  assert.ok(dashboard.includes('mysqlAdmin.getDueFollowups()'));
  const badges = codeOnly(read('admin/pages/dashboard/useDashboardBadges.ts'));
  assert.ok(badges.includes('(dueFollowups ?? 0)'));
  assert.ok(!/\bleads\.filter\(/.test(badges), 'the badge counts the loaded leads again');
  const route = codeOnly(read('api/routes/admin/leads/stats.js'));
  const handler = route.slice(route.indexOf("'/api/admin/leads/followups-due'"));
  assert.ok(handler.includes("requirePermission('view_leads')"));
  // The same scope as the leads list, and the same «open» and follow-up date as the browser.
  assert.ok(handler.includes("leadScope(req, 'l')"));
  assert.ok(handler.includes('TERMINAL_LIST'));
  assert.ok(handler.includes('NEXT_FOLLOWUP'));
});
