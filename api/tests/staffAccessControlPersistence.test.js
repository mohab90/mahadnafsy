'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const employees = read('routes', 'hr', 'employees.js');
const staffRoute = read('routes', 'staff.js');
const authTenant = read('lib', 'authTenant.js');
const leadAccess = read('lib', 'leadAccess.js');
const staffProfileUi = read('..', 'admin', 'pages', 'StaffProfile.tsx');

test('the employee editor can actually persist permissions and data scope', () => {
  // The admin panel has shown a full permission grid on the staff page for a
  // while, but PUT /api/admin/hr/employees/:id never listed permissions_json
  // among its writable fields — every tick was dropped on save and the account
  // silently kept running on its role defaults. That is what made staff
  // accounts show sections nobody had granted them.
  assert.match(employees, /updates\.permissions_json = list\.length/);
  assert.match(employees, /updates\.data_scope = normalizeDataScope\(rawScope\)/);
  // Granting access is an authority change, not an HR data edit.
  assert.match(employees, /if \(req\.isSuperAdmin\) \{[\s\S]{0,600}rawPerms/);
  // …and nobody edits their own reach.
  assert.match(employees, /'permissions', 'permissions_json', 'data_scope', 'dataScope',/);
  // Unknown tokens are rejected rather than stored and later ignored.
  assert.match(employees, /Unknown permission\(s\)/);
  // The UI has to send them for any of the above to matter.
  assert.match(staffProfileUi, /data_scope: payload\.dataScope \|\| null/);
});

test('data_scope travels with every staff record and overrides the role default', () => {
  assert.match(authTenant, /id, role, data_scope, permissions_json, tenant_id/);
  assert.match(authTenant, /id, role, data_scope, tenant_id/);
  assert.match(leadAccess, /resolveDataScope\(staffRecord, \{ fallback: 'assigned_sales' \}\)/);
  assert.match(staffRoute, /const dataScope = normalizeDataScope\(s\.dataScope \?\? s\.data_scope\)/);

  const { normalizeDataScope, resolveDataScope } = require('../constants/permissions');
  assert.equal(normalizeDataScope('ALL'), 'all');
  assert.equal(normalizeDataScope('branch:daqqi, DAQQI '), 'branch:DAQQI');
  assert.equal(normalizeDataScope('branch:NOT_A_BRANCH'), null);
  assert.equal(normalizeDataScope('sudo'), null);
  assert.equal(normalizeDataScope(''), null);

  assert.equal(resolveDataScope({ role: 'hr' }), 'none');
  assert.equal(resolveDataScope({ role: 'hr', data_scope: 'all' }), 'all');
  // A bad override must never widen reach — it falls back to the role.
  assert.equal(resolveDataScope({ role: 'hr', data_scope: 'sudo' }), 'none');
  assert.equal(resolveDataScope({ role: 'hr' }, { isSuperAdmin: true }), 'all');
});

test('sales-team management is its own permission, not a reporting one', () => {
  // view_reports also opens the KPI dashboard, retention, cohort and expense
  // analytics; a sales manager gated on it was handed the whole admin group.
  const offers = read('routes', 'admin', 'offers.js');
  const salesAnalytics = read('routes', 'analytics', 'sales.js');
  assert.match(offers, /sales-offers'.{0,80}requirePermission\('manage_sales_team'\)/);
  assert.match(salesAnalytics, /post\('\/api\/admin\/sales-targets'[\s\S]{0,700}requirePermission\('manage_sales_team'\)/);
  const { ROLE_PERMS, ROLES } = require('../constants/permissions');
  for (const role of [ROLES.SALES_COLLECTION_MANAGER, ROLES.ONLINE_MANAGER, ROLES.DAQQI_MANAGER]) {
    assert.ok(ROLE_PERMS[role].includes('manage_sales_team'), `${role} should manage the sales team`);
  }
  assert.ok(!ROLE_PERMS[ROLES.SALES].includes('manage_sales_team'), 'a rep does not set their own target');
});

test('menu groups are not opened by permissions every employee holds', () => {
  const shared = read('..', 'admin', 'pages', 'dashboard', 'dashboardShared.tsx');
  const map = shared.slice(shared.indexOf('const TAB_PERMISSION_MAP'));
  const body = map.slice(0, map.indexOf('\n};'));
  const entries = new Map(
    [...body.matchAll(/^\s{2}([a-z_0-9]+):\s*'([a-z_0-9]+)'/gm)].map(m => [m[1], m[2]])
  );
  // Only the personal portal may ride on view_dashboard. Anything else mapped
  // there appears in every single employee's sidebar — which is how الإدارة
  // and التسويق ended up visible to sales reps.
  const personal = new Set(['staff_home', 'staff_settings', 'my_hr']);
  const leaked = [...entries].filter(([tab, perm]) => perm === 'view_dashboard' && !personal.has(tab));
  assert.deepEqual(leaked, [], `these tabs open for every employee: ${leaked.map(x => x[0]).join(', ')}`);
});
