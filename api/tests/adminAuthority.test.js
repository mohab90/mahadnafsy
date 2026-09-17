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
