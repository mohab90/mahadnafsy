'use strict';

// Every role, checked the way the sales account was checked by hand.
//
// Three questions, asked of all sixteen rather than of whichever one somebody
// happened to log into:
//
//   1. Is every tab in a role's own nav bar one that role can open? Six roles
//      get a horizontal CompactRoleNav instead of the sidebar, and that list is
//      hand-written — the sidebar is filtered by TAB_PERMISSION_MAP at render
//      time, the bars are not. That is how «إحصائياتي» sat in the sales bar
//      pointing at a tab gated on view_financial, and how «العملاء المحتملين»
//      sat in the collection bar pointing at one gated on view_leads.
//
//   2. Does a role granted a permission over customer rows have a data scope
//      that can return any? 'none' means every query becomes AND 1=0 — the tab
//      opens and the screen is empty, which reads as a bug in the screen.
//
//   3. Can a role that signs in reach anything at all?

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const run = (script) => JSON.parse(execFileSync(
  process.execPath,
  [path.join(ROOT, 'tools', script), '--json'],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
));

test('every tab a role bar offers is one that role can open', () => {
  const { bars, findings } = run('role-bar-gate-scan.mjs');
  // Denominator: a scan that parsed no bars would pass while checking nothing.
  assert.equal(bars, 6, `expected the six role bars, parsed ${bars}`);
  assert.deepEqual(
    findings.map(f => `${f.role} · ${f.key} — ${f.why}`),
    [],
    'these open onto «غير مصرح بالوصول» for the employee who is offered them'
  );
});

test('no role is granted a permission over rows its scope cannot return', () => {
  const { scopeless } = run('role-bar-gate-scan.mjs');
  assert.deepEqual(
    scopeless.map(s => `${s.role}: ${s.held.join(', ')}`),
    [],
    "a permission with data scope 'none' does not open a screen, it opens an empty one"
  );
});

test('every role reaches at least one screen, and the ones that run a team are the ones who see it', () => {
  const rows = run('role-reachable-screens.mjs');
  const byRole = Object.fromEntries(rows.map(r => [r.role, r]));

  assert.ok(rows.length >= 15, `expected the full role list, saw ${rows.length}`);

  // 'other' is a staff record with no system access by design — it still
  // reaches ملفي الشخصي and ملفي الوظيفي through the top bar, which is not
  // permission-filtered. Every other role must have a sidebar or a bar.
  for (const row of rows) {
    if (row.role === 'other' || row.count === 'all') continue;
    assert.ok(row.count > 0, `${row.role} signs in and reaches nothing`);
  }

  // The screens that run the sales and online teams. A consultant's job is
  // therapy sessions; they were being shown the sales hub, the sales reports,
  // the sales team's performance, the online team's assignments and the
  // quarter's targets, because all five were gated on view_leads or
  // view_subscribers — permissions that mean "may read a record".
  const teamScreens = ['sales_hub', 'sales_reports', 'sales_team', 'online_team', 'sales_planning'];
  for (const role of ['consultant', 'support', 'expert', 'trainer', 'instructor', 'hr']) {
    const seen = (byRole[role]?.tabs || []).filter(t => teamScreens.includes(t));
    assert.deepEqual(seen, [], `${role} is offered ${seen.join(', ')}`);
  }

  // And the roles that do run them keep them.
  const { ROLE_PERMS } = require('../constants/permissions');
  for (const role of ['online_manager', 'daqqi_manager', 'sales_collection_manager']) {
    assert.ok(ROLE_PERMS[role].includes('manage_sales_team'),
      `${role} runs a team and must still open its screens`);
  }
});

test('every quick action on the landing page opens for the role it is offered to', () => {
  // The third navigation surface. StaffHomeTab draws a row of buttons on
  // «ملفي الشخصي» — the page every employee lands on — and each navigates to a
  // tab key. The sidebar is filtered at render time and the role bars have
  // their own scan; this list had neither, so «لوحة المهام» sat on the landing
  // page of five roles that could not open it, and «ليداتي» on خدمة العملاء's.
  const { base, extra, findings } = run('quick-action-gate-scan.mjs');
  assert.ok(base.length >= 2, `expected the base actions, parsed ${base.length}`);
  assert.ok(extra >= 3, `expected the role-conditional actions, parsed ${extra}`);
  assert.deepEqual(findings, [], 'these are dead buttons on the page every employee lands on');
});

test('the task board is offered only to whoever can open it', () => {
  // GET /api/admin/tasks asks only for view_dashboard and scopes a non-manager
  // to their own rows, so the tab could in principle be that loose — but it
  // lives in the الإدارة group, and a group appears when any one of its items
  // does. Loosening the gate would have put الإدارة in every employee's
  // sidebar, which staffAccessControlPersistence.test.js exists to prevent.
  //
  // So the gate stays and the button is conditional. The employee's own tasks
  // are on «ملفي الشخصي» either way: the panel above loads them with ?my=true.
  const fsSync = require('node:fs');
  const gates = fsSync.readFileSync(path.join(ROOT, 'admin/pages/dashboard/dashboardShared.tsx'), 'utf8');
  assert.ok(gates.includes("tasks_board:        'view_reports',"),
    'loosening this puts the الإدارة group in every employee sidebar');

  const home = fsSync.readFileSync(path.join(ROOT, 'admin/pages/dashboard/tabs/StaffHomeTab.tsx'), 'utf8');
  assert.ok(home.includes("hasPermission(staff as unknown as { role: RoleKey; permissions?: PermissionKey[] }, 'view_reports')"),
    'the quick action is offered again to roles that cannot open it');
  // And the page still shows them their own tasks regardless.
  assert.ok(home.includes("'/api/admin/tasks?limit=5&my=true'"),
    'the employee lost the only view of their own tasks');
});

test('a collection officer can open the leads screen in their own bar', () => {
  const { ROLE_PERMS, DATA_SCOPE } = require('../constants/permissions');
  assert.ok(ROLE_PERMS.collection.includes('view_leads'),
    '«العملاء المحتملين» is in the collection bar and answered «غير مصرح بالوصول»');
  // Scoped, not open: they see the leads of customers assigned to them.
  assert.equal(DATA_SCOPE.collection, 'assigned_cs');
});

test('an inert permission is not left on a role', () => {
  const { ROLE_PERMS, DATA_SCOPE } = require('../constants/permissions');
  // expert held view_subscribers with scope 'none' — it opened «عملاء الأونلاين»
  // and showed nothing, because 'none' scopes every query to nobody.
  assert.ok(!ROLE_PERMS.expert.includes('view_subscribers'));
  assert.equal(DATA_SCOPE.expert, 'none');
});
