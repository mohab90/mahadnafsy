'use strict';

// Who counts as a full-access caller, and where that is decided.
//
// Four guards in middleware/auth.js resolve a staff record. Three of them raised
// `req.isSuperAdmin` for a full-access role; requireAdminOrStaff — the one that
// admits every staff member, and the guard on most of the admin API — did not.
// Eighteen refusals downstream read that flag to decide whether the caller may
// act, so an account whose role is ADMIN or MANAGER was refused:
//
//   * the permission grid and the data-scope picker on the staff page
//     (403 PERMISSIONS_REQUIRE_SUPERADMIN — reproduced against staging, where a
//     role=admin caller could not change one permission on one employee);
//   * creating a staff row in a privileged role, or a login with a password;
//   * the Dokki round controls.
//
// The only way to hold that authority was to have your email written into an
// environment variable on the server — which is why the institute's own
// managers could edit a permission grid all day and change nothing.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const auth = fs.readFileSync(path.join(API, 'middleware', 'auth.js'), 'utf8');
/** A file under api/, or under the repo root with a leading '..'. */
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');

/** The body of one guard function, from its declaration to the next one. */
function guardBody(name) {
  const start = auth.indexOf(`async function ${name}(`);
  assert.ok(start > 0, `${name} is gone from middleware/auth.js`);
  const next = auth.indexOf('\nasync function ', start + 1);
  const end = auth.indexOf('\nfunction ', start + 1);
  const stop = [next, end].filter(i => i > 0).sort((a, b) => a - b)[0] || auth.length;
  return auth.slice(start, stop);
}

test('every guard that resolves a staff record raises a full-access role', () => {
  for (const guard of ['requireAdmin', 'requireAdminOrOnlineManager', 'requireAdminOrOnlineManagerOrCollection', 'requireAdminOrStaff']) {
    const body = guardBody(guard);
    assert.match(body, /findActiveStaff/, `${guard} no longer looks the caller up`);
    // The property, not the spelling: after the lookup, a full-access role
    // raises the flag. Each guard writes that differently.
    const afterLookup = body.slice(body.indexOf('findActiveStaff'));
    assert.match(afterLookup, /FULL_ACCESS_ROLES/,
      `${guard} decides authority from the environment list alone — an ADMIN or MANAGER account is refused`);
    assert.match(afterLookup, /req\.isSuperAdmin = true/, `${guard} never raises the flag for the role it just read`);
  }
});

test('the roles that carry full access are the two the product calls top', () => {
  const { FULL_ACCESS_ROLES, DATA_SCOPE } = require('../constants/permissions');
  assert.deepEqual([...FULL_ACCESS_ROLES].sort(), ['admin', 'manager']);
  // Raising the flag for them changes no data boundary: it is what they had.
  assert.equal(DATA_SCOPE.admin, 'all');
  assert.equal(DATA_SCOPE.manager, 'all');
});

test('the permission grid is gated on that flag, not on a role string', () => {
  const employees = fs.readFileSync(path.join(API, 'routes', 'hr', 'employees.js'), 'utf8');
  assert.match(employees, /sentAccessFields && !req\.isSuperAdmin/);
  assert.match(employees, /PERMISSIONS_REQUIRE_SUPERADMIN/);
});

test('your own profile is not a section you need rights to enter', () => {
  // Watched live on production: the HR manager's grid had been narrowed to lead
  // and client work — no view_dashboard, no view_hr — so «ملفي الشخصي» answered
  // «غير مصرح بالوصول» before the page even called the API, and the API would
  // have refused it too.
  const profile = fs.readFileSync(path.join(API, 'routes', 'hr', 'staffprofile.js'), 'utf8');
  for (const route of ['profile', 'report', 'messages']) {
    const line = new RegExp(`router\\.get\\('/api/admin/hr/staff/:id/${route}'[^\\n]*`).exec(profile);
    assert.ok(line, `the ${route} route is gone`);
    assert.match(line[0], /requirePermissionOrSelf\('view_hr'\)/,
      `reading your own ${route} still demands view_hr`);
  }
  // Writing to somebody's file is a different act and stays where it was.
  const post = /router\.post\('\/api\/admin\/hr\/staff\/:id\/messages'[^\n]*/.exec(profile);
  assert.match(post[0], /requirePermission\('manage_hr'\)/);

  // …and the middleware only waives the permission for your own id.
  const helper = auth.slice(auth.indexOf('function requirePermissionOrSelf'));
  assert.match(helper, /String\(req\.staffRecord\.id\) === String\(req\.params\?\.\[param\]\)/);
  assert.match(helper, /if \(!mine\) return gate\(req, res, next\)/);
});

test('the personal panels answer their owner, and still only their own rows', () => {
  // Her own landing page showed her name and two «Permission denied:
  // view_dashboard» toasts: her tasks and her notifications. Both handlers had
  // always scoped a non-manager to their own rows — the gate was refusing a
  // question that was already answered safely.
  const tasks = fs.readFileSync(path.join(API, 'routes', 'campaigns.js'), 'utf8');
  const notifications = fs.readFileSync(path.join(API, 'routes', 'notifications.js'), 'utf8');
  for (const [name, src] of [['tasks', tasks], ['notifications', notifications]]) {
    assert.ok(!/router\.[a-z]+\('\/api\/admin\/(tasks|notifications)[^\n]*requirePermission\('view_dashboard'\)/.test(src),
      `a ${name} route asks for view_dashboard again — an employee cannot reach their own`);
  }
  // The waiver only holds while the scoping does, so the scoping is pinned here.
  assert.match(tasks, /const mineOnly = askedForMine \|\| !taskManager\(req\)/);
  for (const write of [/DELETE FROM tasks WHERE id=\?[^`]*taskManager\(req\) \? '' : ' AND \(assigned_to=\? OR created_by=\?\)'/,
    /UPDATE tasks SET[\s\S]{0,400}taskManager\(req\) \? '' : ' AND \(assigned_to=\? OR created_by=\?\)'/]) {
    assert.match(tasks, write, 'a task write stopped scoping a non-manager to their own rows');
  }
  assert.match(notifications, /const visibility = visibilitySql\(req\);/);
  // A caller with no staff record at all is still refused by the permission.
  const helper = auth.slice(auth.indexOf('function requirePermissionOrOwnRows'));
  assert.match(helper, /if \(!req\.staffRecord && !req\.isSuperAdmin\) return gate\(req, res, next\)/);
});

test('the personal tabs are open to every staff member, and only those', () => {
  const shared = fs.readFileSync(path.join(API, '..', 'admin', 'pages', 'dashboard', 'dashboardShared.tsx'), 'utf8');
  for (const tab of ['staff_home', 'staff_settings', 'my_hr']) {
    assert.match(shared, new RegExp(`${tab}:\\s*null`), `${tab} still asks for a permission`);
  }
  // null means "yours"; undefined still means denied, in both gates.
  const container = fs.readFileSync(path.join(API, '..', 'admin', 'pages', 'dashboard', 'DashboardTabContainer.tsx'), 'utf8');
  assert.match(container, /requiredPermission === null\s*\?\s*true/);
  assert.match(container, /requiredPermission !== undefined && hasPermission\(requiredPermission\)/);
  const dashboard = fs.readFileSync(path.join(API, '..', 'admin', 'pages', 'Dashboard.tsx'), 'utf8');
  assert.match(dashboard, /if \(required === null\) return true;/);
});

test('a team-performance key opens one team screen and nothing else', () => {
  // The owner wanted to hand somebody the performance of a team without the
  // department it belongs to: HR sees how the Dokki and online teams are doing,
  // not their clients, their money or their day-to-day. Before this the only
  // key that opened «فريق دقي» was manage_daqqi, which also opens the schedule,
  // the clients, the accounting and the waiting list — the smallest grant
  // available was the whole department. So each of these must stay small.
  const shared = fs.readFileSync(path.join(API, '..', 'admin', 'pages', 'dashboard', 'dashboardShared.tsx'), 'utf8');
  const start = shared.indexOf('const TAB_PERMISSION_MAP');
  const map = shared.slice(start, shared.indexOf('\n};', start));
  const opensFor = permission => [...map.matchAll(/^\s*([a-z_]+):\s*(null|\[[^\]]*\]|'[a-z_]+')/gm)]
    .filter(entry => entry[2].includes(`'${permission}'`))
    .map(entry => entry[1]);

  assert.deepEqual(opensFor('view_perf_daqqi'), ['daqqi_team']);
  assert.deepEqual(opensFor('view_perf_online'), ['online_team']);
  assert.deepEqual(opensFor('view_perf_sales'), ['sales_team']);

  // Each is a real permission on both sides, and no role hands one out by
  // default — they exist to be given to a person, one at a time.
  const { PERMISSIONS, ROLE_PERMS } = require('../constants/permissions');
  const all = new Set(Object.values(PERMISSIONS));
  for (const permission of ['view_perf_daqqi', 'view_perf_online', 'view_perf_sales']) {
    assert.ok(all.has(permission), `${permission} is not in the master list`);
    for (const [role, perms] of Object.entries(ROLE_PERMS)) {
      if (perms === '*') continue;
      assert.ok(!perms.includes(permission), `${role} defaults now carry ${permission}`);
    }
  }
  // And the department keys still open their own screens, so nothing changed
  // for the people who run those departments.
  assert.ok(opensFor('manage_daqqi').includes('daqqi_team'));
  assert.ok(opensFor('manage_sales_team').includes('sales_team'));
  assert.ok(opensFor('manage_sales_team').includes('online_team'));
});

test('the Dokki team screen gets its figures from the server, not from the rounds', () => {
  // Granting the key was not enough: every number on «فريق دقي» was derived in
  // the browser out of the full rounds array, and a performance-only viewer has
  // no rounds array — so the screen opened and read 0 rounds, 0 students,
  // 0 ج.م. An answer that looks like an answer and is not one.
  const route = fs.readFileSync(path.join(API, 'routes', 'daqqi-rounds.js'), 'utf8');
  const line = /router\.get\('\/api\/admin\/daqqi-performance'[^\n]*\n[^\n]*/.exec(route);
  assert.ok(line, 'the Dokki performance route is gone');
  assert.match(line[0], /requireAnyPermission\(PERMISSIONS\.MANAGE_DAQQI, PERMISSIONS\.VIEW_PERF_DAQQI\)/);
  // Figures only: nothing in the response names a student or a round.
  const body = route.slice(route.indexOf("'/api/admin/daqqi-performance'"), route.indexOf("router.get('/api/admin/daqqi-rounds'"));
  assert.ok(!/a\.name|a\.phone|SELECT \*/.test(body), 'the performance response carries attendee identity');
  assert.match(body, /COUNT\(DISTINCT r\.id\)/, 'the attendee join would count one round as several');
  assert.match(body, /canSeeDetail/);
  // daqqi_rounds.status is ENUM('NEW','ACTIVE','FINISHED'), answered in the
  // declared spelling: comparing it to 'new' in JS matched nothing, so the
  // total read 2 and every bucket read 0. Caught against staging, not in review.
  assert.match(body, /String\(row\.status \|\| ''\)\.toLowerCase\(\) === status/);
  // Compared to the spelling the ENUM declares, which matches without wrapping
  // the column in a function — scanCoverage refuses LOWER/UPPER on an indexed
  // column, and it was right to: the first fix defeated the index to solve a
  // problem the declared spelling solves for free.
  assert.match(body, /WHEN r\.status='ACTIVE'/);
  assert.ok(!/UPPER\(r\.status\)|WHEN r\.status='active'/.test(body),
    'the status comparison either defeats the index or is case-sensitive again');

  // And the screen uses it, including to decide whether to offer the schedule.
  const tab = fs.readFileSync(path.join(API, '..', 'admin', 'pages', 'dashboard', 'tabs', 'DaqqiTeamTab.tsx'), 'utf8');
  assert.match(tab, /getDaqqiPerformance\(\)/);
  assert.match(tab, /const detailAvailable = perf \? perf\.canSeeDetail : daqqiRounds\.length > 0;/);
  assert.match(tab, /perf \? perf\.rounds\.active : activeRounds\.length/);
  assert.match(tab, /perf \? perf\.students : totalAttendees/);
  assert.ok(!/\{rounds\.length\}<\/div><div className="text-gray-400">روندات/.test(tab),
    'the per-instructor round count is read off the rounds array again');
});

test('each team screen has a figures-only source, and خدمة العملاء has a screen at all', () => {
  // The same treatment for the other three sections. Two of them had a team
  // screen that counted its own numbers in the browser — so a performance-only
  // viewer read zeros, the way Dokki did. خدمة العملاء had no team screen: every
  // tab in it is one customer's problem in detail, so there was nothing to grant
  // somebody who should see how the team is doing.
  const sources = [
    ['routes/support.js', '/api/admin/cx-performance', /requireAnyPermission\(PERMISSIONS\.MANAGE_INBOX, PERMISSIONS\.VIEW_PERF_CX\)/],
    ['routes/admin/stafflists.js', '/api/admin/online-performance', /requireAnyPermission\(PERMISSIONS\.MANAGE_SALES_TEAM, PERMISSIONS\.VIEW_PERF_ONLINE\)/],
    ['routes/analytics/sales.js', '/api/admin/reports/sales-performance', /requireAnyPermission\(PERMISSIONS\.MANAGE_SALES_TEAM, PERMISSIONS\.VIEW_PERF_SALES\)/],
  ];
  for (const [file, route, gate] of sources) {
    const src = read(file);
    const at = src.indexOf(`router.get('${route}'`);
    assert.ok(at > 0, `${route} is gone`);
    assert.match(src.slice(at, at + 400), gate, `${route} is not open to the performance key`);
  }

  // The service figures are what a ticket records, not what a customer wrote.
  const support = read('routes/support.js');
  const cx = support.slice(support.indexOf("'/api/admin/cx-performance'"), support.indexOf("router.get('/api/admin/cs/inbox'"));
  assert.ok(!/t\.subject|t\.body|subscriber_name|subscriber_email/.test(cx),
    'the service performance response carries what a customer wrote');
  assert.match(cx, /csat_score/, 'the customer\'s own score is the point of a service scoreboard');
  assert.match(cx, /TIMESTAMPDIFF\(MINUTE, t\.created_at, t\.first_response_at\)/);

  // A rep's pay is not part of how the team is doing.
  const sales = read('routes/analytics/sales.js');
  assert.match(sales, /const seesPay = Boolean\(req\.isSuperAdmin\) \|\| hasPermission\(req\.staffRecord, PERMISSIONS\.MANAGE_SALES_TEAM\)/);
  assert.match(sales, /const \{ email: _email, commission_rate: _rate, \.\.\.rest \} = s;/);

  // And the new screen is reachable: a key, a route entry, a renderer.
  const shared = read(path.join('..', 'admin', 'pages', 'dashboard', 'dashboardShared.tsx'));
  assert.match(shared, /cx_team:\s*\['manage_inbox', 'view_perf_cx'\]/);
  assert.match(read(path.join('..', 'admin', 'pages', 'dashboard', 'dashboardTabGroups.ts')), /'cx_team'/);
  assert.match(read(path.join('..', 'admin', 'pages', 'dashboard', 'GeneralDashboardTabs.tsx')), /key: 'cx_team', Component: CxTeamTab/);
  assert.match(read(path.join('..', 'admin', 'pages', 'dashboard', 'navigation.tsx')), /key: 'cx_team', label: 'أداء فريق خدمة العملاء'/);

  // The two older screens read the server's figures now.
  assert.match(read(path.join('..', 'admin', 'pages', 'dashboard', 'tabs', 'OnlineTeamMgmtTab.tsx')), /getOnlinePerformance\(\)/);
  assert.match(read(path.join('..', 'admin', 'pages', 'dashboard', 'tabs', 'SalesTeamTab.tsx')), /getSalesTeamPerformance\(\)/);
});

test('an HR account sees no client data until someone gives it a scope', () => {
  // Asked directly: is the HR account empty? It is, by the role's own default —
  // `hr` scopes to 'none', so every lead and subscriber query filters to nothing
  // whatever the permission grid says. staff.data_scope is the override, and
  // setting it is exactly the edit that was returning 403.
  const { DATA_SCOPE, resolveDataScope, normalizeDataScope } = require('../constants/permissions');
  assert.equal(DATA_SCOPE.hr, 'none');
  assert.equal(resolveDataScope({ role: 'hr' }), 'none');
  assert.equal(resolveDataScope({ role: 'hr', data_scope: 'all' }), 'all');
  assert.equal(resolveDataScope({ role: 'hr', data_scope: 'branch:DAQQI' }), 'branch:DAQQI');
  // Collection work needs the money permissions too; the HR defaults carry none.
  const { ROLE_PERMS } = require('../constants/permissions');
  assert.ok(!ROLE_PERMS.hr.includes('view_financial'));
  assert.ok(!ROLE_PERMS.hr.includes('view_leads'));
  assert.equal(normalizeDataScope('nonsense'), null);
});
