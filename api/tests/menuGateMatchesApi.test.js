'use strict';
/**
 * A menu gate looser than the API behind it is the worst version of a
 * permission system: the person is offered the screen, opens it, and the server
 * refuses them.
 *
 * An HR manager holds view_reports — for HR's own reports — and view_staff, to
 * run the directory. Those two were standing in for "management" and "sales"
 * across the tab map, so that account was offered the KPI dashboard, the
 * institute overview, the sales team, sales reports and the security centre.
 * Every one either answered 403 or showed data that was not theirs.
 * Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const gates = codeOnly(read('admin/pages/dashboard/dashboardShared.tsx'));
const permissions = read('admin/constants/permissions.ts');

/** The permission(s) a tab is gated on, as written in the map. */
const gateFor = tab => {
  const match = gates.match(new RegExp(`\\b${tab}:\\s*(\\[[^\\]]*\\]|'[a-z_]+')`));
  assert.ok(match, `${tab} must have a gate`);
  return (match[1].match(/'([a-z_]+)'/g) || []).map(s => s.replace(/'/g, ''));
};

/** What a role is granted in ROLE_PERMISSIONS. */
const roleGrants = role => {
  const start = permissions.indexOf(`  ${role}: [`);
  assert.ok(start > 0, `${role} must be a role`);
  const body = permissions.slice(start, permissions.indexOf('],', start));
  return new Set((body.match(/'([a-z_]+)'/g) || []).map(s => s.replace(/'/g, '')));
};

const hr = roleGrants('hr');

test('the HR account holds exactly what it needs and nothing that opens sales', () => {
  // These are why the misfiled gates let HR through, and they are correct
  // grants — HR runs the directory and reads HR reports.
  assert.ok(hr.has('view_reports'));
  assert.ok(hr.has('view_staff'));
  assert.ok(hr.has('manage_staff'));
  // And these are what the sales and money screens should be keyed on.
  assert.ok(!hr.has('view_leads'), 'HR does not read the pipeline');
  assert.ok(!hr.has('view_financial'), 'nor the institute ledger');
  assert.ok(!hr.has('view_subscribers'), 'nor the customer list');
});

test('no screen an HR account can open answers 403', () => {
  // Each pairing is the API the screen calls, read from the route file.
  const routes = {
    kpi_dashboard: read('api/routes/analytics/dashboard.js'),
    sales_planning: read('api/routes/analytics/sales.js'),
  };
  assert.match(routes.kpi_dashboard, /router\.get\('\/api\/admin\/kpi\/summary', requireAuth, requireAdmin/,
    'the KPI summary is admin-only, so its tab cannot be gated on view_reports');
  assert.match(routes.sales_planning, /router\.get\('\/api\/admin\/sales-targets', requireAuth, requireAdminOrStaff, requirePermission\('view_leads'\)/,
    'the collection target needs view_leads');
  assert.match(read('api/routes/admin/leads.js'), /router\.get\('\/api\/admin\/leads\/staff-performance', requireAuth, requireAdminOrStaff, requirePermission\('view_leads'\)/);

  // So none of these may be reachable by a permission HR holds.
  for (const tab of ['overview', 'kpi_dashboard', 'sales_planning', 'sales_team', 'sales_reports', 'staff_performance', 'online_team', 'security_center']) {
    const allowed = gateFor(tab);
    const opensForHr = allowed.filter(permission => hr.has(permission));
    assert.deepEqual(opensForHr, [],
      `${tab} opens for HR through ${opensForHr.join(', ')} and its API refuses them`);
  }
});

test('security is not gated on the permission that defines an HR manager', () => {
  const allowed = gateFor('security_center');
  assert.ok(!allowed.includes('manage_staff'),
    'manage_staff is what makes someone HR, and it was opening the security centre');
  assert.ok(allowed.includes('view_security') || allowed.includes('manage_security'));
});

test('the team screens show the team they are named for', () => {
  const sales = codeOnly(read('admin/pages/dashboard/tabs/SalesTeamTab.tsx'));
  assert.match(sales, /SALES_ROLES = new Set\(\['sales', 'sales_collection_manager'\]\)/);
  assert.match(sales, /SALES_ROLES\.has\(String\(s\.role \|\| ''\)\.toLowerCase\(\)\)/,
    'it listed every staff member and ranked them all by conversion rate');

  const online = codeOnly(read('admin/pages/dashboard/tabs/OnlineTeamMgmtTab.tsx'));
  assert.ok(online.includes("'collection'"),
    'the collection desk works the online pipeline and was excluded, leaving the screen all but empty');
  assert.ok(!online.includes("['online_manager', 'support', 'consultant'].includes(s.role)"));
});
