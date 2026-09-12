'use strict';

// A permission says *whether* an employee may open a screen. DATA_SCOPE says
// *whose rows* they get — a sales rep is 'assigned_sales', a collection officer
// 'assigned_cs', a Daqqi manager 'branch:DAQQI', a trainer 'none'. The first is
// enforced by middleware and hard to forget. The second is enforced by the
// route remembering to call a scope helper, and easy to.
//
// Forgotten, it does not fail: the screen shows every customer in the institute
// to someone entitled to a handful.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROLE_PERMS, DATA_SCOPE } = require('../constants/permissions');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

/** Every non-wildcard role holding a permission, with its data scope. */
const holders = permission => Object.entries(ROLE_PERMS)
  .filter(([, perms]) => perms !== '*' && perms.includes(permission))
  .map(([role]) => ({ role, scope: DATA_SCOPE[role] || 'none' }));

test("the institute's revenue is not readable by everyone with a staff login", () => {
  const route = codeOnly(read('api/routes/analytics/dashboard.js'));
  // It answers revenue this month, last month and all time, unscoped, because
  // a summary of the whole business is what it is for. It was gated on
  // view_dashboard — the permission that only means "is staff", which every
  // role holds down to «موظف»: a trainer's session cookie read the books.
  assert.ok(
    route.includes("router.get('/api/admin/dashboard/kpi', requireAuth, requireAdminOrStaff, requirePermission('view_financial')"),
    'the KPI summary is open to a permission every employee holds'
  );
  // The premise: view_dashboard really is universal.
  const universal = holders('view_dashboard').map(h => h.role);
  assert.ok(universal.length >= 12, `view_dashboard should be near-universal, found ${universal.length} roles`);
  assert.ok(universal.includes('trainer') && universal.includes('other'));

  // view_financial is not enough on its own either: a collection officer holds
  // it and is scoped to the customers assigned to them, the Daqqi manager to a
  // branch. A total cannot be narrowed, so the route refuses instead.
  assert.ok(route.includes('const scope = resolveDataScope(req.staffRecord'));
  assert.ok(route.includes("if (scope !== 'all')"));
  assert.ok(route.includes('INSTITUTE_WIDE_SCOPE_REQUIRED'));
  const financialScopes = new Set(holders('view_financial').map(h => h.scope));
  assert.ok(financialScopes.size > 1, 'if every view_financial holder were "all" this guard would be pointless');
});

test('the consultations calendar answers nobody whose scope is none, and no join links', () => {
  const route = codeOnly(read('api/routes/misc/reminders.js'));
  const calendar = route.slice(route.indexOf("'/api/admin/consultations/calendar'"));
  const body = calendar.slice(0, calendar.indexOf('\n});'));

  // Eight roles hold view_consultations; three of them see no customer rows at
  // all by declared scope.
  const scopeNone = holders('view_consultations').filter(h => h.scope === 'none').map(h => h.role);
  assert.deepEqual(scopeNone.sort(), ['expert', 'instructor', 'trainer']);

  assert.match(body, /resolveDataScope\(req\.staffRecord/);
  assert.match(body, /if \(scope === 'none'\) return res\.json\(/);

  // And a scheduling view does not carry a private join link. The two places
  // that need one have it: the therapist's portal and the customer's dashboard.
  assert.ok(!body.includes('c.meeting_link'),
    'a month of live therapy join links goes to everyone who can read a schedule');
  // What the calendar is actually for is still there.
  assert.ok(body.includes('c.session_date') && body.includes('t.name AS therapist_name'));
});

test('the refund queue is narrowed to whose customers they are', () => {
  const route = codeOnly(read('api/routes/admin-utils.js'));
  const refunds = route.slice(route.indexOf("'/api/admin/refund-requests'"));
  const body = refunds.slice(0, refunds.indexOf('\n});'));

  assert.match(body, /resolveFinancialScope\(req, \{ allowAssigned: true \}\)/);
  assert.match(body, /financialScopeClause\(refundScope, \{ branchColumn: 's\.branch_id', subscriberAlias: 's' \}\)/);

  // The roles that hold view_financial are not all 'all' — which is the point.
  const scopes = new Set(holders('view_financial').map(h => h.scope));
  assert.ok(scopes.has('all'), 'the accountant and managers must keep the whole queue');
  assert.ok(scopes.size > 1, 'if every holder were "all" this scoping would be pointless');
});

test('the scanner that found these still walks the whole route tree', () => {
  const { execFileSync } = require('node:child_process');
  const out = JSON.parse(execFileSync(
    process.execPath,
    [path.join(ROOT, 'tools', 'staff-data-scope-scan.mjs'), '--json'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  ));
  // Denominators, so a scan that silently stopped matching would be visible
  // rather than reported as a clean bill.
  assert.ok(out.adminRoutes > 500, `expected the admin route tree, saw ${out.adminRoutes}`);
  assert.ok(out.readsScopedTable > 50, `expected the per-employee reads, saw ${out.readsScopedTable}`);
  // The three fixed above are gone from its output.
  const fixed = ['GET /api/admin/dashboard/kpi', 'GET /api/admin/consultations/calendar', 'GET /api/admin/refund-requests'];
  const stillListed = out.findings.map(f => f.route).filter(r => fixed.includes(r));
  assert.deepEqual(stillListed, []);
});
