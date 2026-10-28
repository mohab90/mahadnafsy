'use strict';

// «تلات أنظمة بتقرر الموظف يشوف إيه» (22 Oct 2026): the menu filtered the browser's own copy of the role defaults by
// itself, the tab gate asked constants/permissions.ts, and the role bars and «ملخص الوصول» were hand-written lists.
// They are one rule now — admin/lib/access.ts canOpenTab, over the permissions the server resolves for the account
// (/api/auth/me, api/constants/permissions.js) — and nobody may gain or lose access by it.
//
// fixtures/visibleTabsByRole.json is what every role in the server's permission table could open (the gate), was
// offered in the menu and in its role bar, computed by the code as it stood before the change. Here the same is
// computed by the new rule: the gate must be identical, and the menu and the bar may differ only by entries the gate
// always refused (an admin-role employee off the delete list was offered «أرشيف العملاء»; the online manager's
// «الأكاديمية» offered six screens their role cannot open; collection's grid offered the inbox their job refuses).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const before = require('./fixtures/visibleTabsByRole.json');
const server = require('../constants/permissions');

function bundle() {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const entry = [
    `export { canOpenTab, can, viewerOf, visibleMenu } from ${JSON.stringify(path.join(ROOT, 'admin/lib/access'))};`,
    `export { DASHBOARD_MENU_GROUPS } from ${JSON.stringify(path.join(ROOT, 'admin/pages/dashboard/navigation'))};`,
    `export { branchOfRole } from ${JSON.stringify(path.join(ROOT, 'admin/lib/physicalBranch'))};`,
  ].join('\n');
  const out = esbuild.buildSync({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node',
    logLevel: 'silent', nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' }, jsx: 'automatic',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const lib = bundle();
const skip = lib ? false : 'admin dependencies (esbuild) not installed';

// The role bars as DashboardNavigation.tsx lists them (the parse tools/role-bar-gate-scan.mjs uses).
const BAR_ROLE = {
  isSalesOnly: ['sales'], isCollectionRole: ['collection'], isReceptionDaqqi: ['reception_daqqi', 'reception_tagamoa'],
  isSupport: ['support'], isDaqqiManager: ['daqqi_manager', 'tagamoa_manager'], isOnlineManager: ['online_manager'],
  isSalesCollectionManager: ['sales_collection_manager'],
};
function barTabs() {
  const nav = fs.readFileSync(path.join(ROOT, 'admin/pages/dashboard/DashboardNavigation.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'));
  const bars = {};
  let current = null;
  let depth = 0;
  for (const line of nav) {
    if (!current) {
      const opener = /\{(is[A-Za-z]+) &&/.exec(line);
      if (opener && BAR_ROLE[opener[1]]) { current = { flag: opener[1], tabs: [] }; depth = 0; }
    }
    if (!current) continue;
    for (const ch of line) { if (ch === '(') depth += 1; else if (ch === ')') depth -= 1; }
    for (const m of line.matchAll(/\{ key: '([a-z_]+)'(?: as TabKey)?, label: /g)) current.tabs.push(m[1]);
    if (depth <= 0) { if (current.tabs.length) bars[current.flag] = [...new Set(current.tabs)].sort(); current = null; }
  }
  return bars;
}

const viewerFor = role => lib.viewerOf({ isAdmin: false, role, serverPermissions: server.resolvePermissions({ role }), canDelete: false });
const allTabs = [...new Set(Object.values(before).flatMap(entry => entry.gate))];
const tabUniverse = [...new Set([...allTabs, 'archived_clients', 'team_inbox', 'whatsapp_web', 'no_such_tab'])];

test('the snapshot covers every role of the server\'s permission table', () => {
  assert.deepEqual(Object.keys(before).sort(), Object.keys(server.ROLE_PERMS).sort());
});

test('no role gains or loses a screen it may open', { skip }, () => {
  for (const [role, was] of Object.entries(before)) {
    const viewer = viewerFor(role);
    const now = tabUniverse.filter(tab => lib.canOpenTab(viewer, tab)).sort();
    assert.deepEqual(now, [...was.gate].sort(), `${role}: the screens it may open changed`);
  }
});

test('the menu offers what it offered, less only what the gate always refused', { skip }, () => {
  for (const [role, was] of Object.entries(before)) {
    const viewer = viewerFor(role);
    const ownBranch = lib.branchOfRole(role);
    const groups = lib.DASHBOARD_MENU_GROUPS.filter(group => (group.key === 'tagamoa' ? ownBranch !== 'DAQQI'
      : group.key === 'daqqi' ? ownBranch !== 'TAGAMOA' : true));
    const menu = [...new Set(lib.visibleMenu(groups, viewer).flatMap(group => group.items.map(item => item.key)))].sort();
    const gate = new Set(was.gate);
    assert.deepEqual(menu, was.menu.filter(key => gate.has(key)), `${role}: the menu changed beyond the refused entries`);
    assert.ok(menu.every(key => lib.canOpenTab(viewer, key)), `${role}: the menu offers a screen the gate refuses`);
  }
});

test('each role bar lists what it listed and shows only what the role may open', { skip }, () => {
  const bars = barTabs();
  for (const [role, was] of Object.entries(before)) {
    if (!was.bar) continue;
    const flag = Object.entries(BAR_ROLE).find(([, roles]) => roles.includes(role))[0];
    assert.deepEqual(bars[flag], was.bar, `${role}: the bar's own list changed`);
    const viewer = viewerFor(role);
    const shown = was.bar.filter(key => lib.canOpenTab(viewer, key));
    const gate = new Set(was.gate);
    assert.deepEqual(shown, was.bar.filter(key => gate.has(key)), `${role}: the bar shows something the gate refuses`);
  }
  // The bar filters itself through the same rule at render time.
  const nav = fs.readFileSync(path.join(ROOT, 'admin/pages/dashboard/DashboardNavigation.tsx'), 'utf8');
  assert.match(nav, /const \{ canOpenTab \} = useAccess\(\);/);
  assert.match(nav, /\.filter\(item => access\.canOpenTab\(item\.key\)\)/, 'the online manager\'s academy menu too');
});

test('a permission means what the server says it means', { skip }, () => {
  const perms = [...new Set(Object.values(server.ROLE_PERMS).flatMap(list => (Array.isArray(list) ? list : [])).concat(['branch_hr', 'view_hr', 'manage_hr']))];
  for (const role of Object.keys(server.ROLE_PERMS)) {
    const viewer = { ...viewerFor(role), canDelete: true };
    for (const permission of perms) {
      assert.equal(lib.can(viewer, permission), server.hasPermission({ role }, permission), `${role} / ${permission}`);
    }
  }
  // The administrator opens everything, and nobody off the owner's list deletes.
  const admin = lib.viewerOf({ isAdmin: true, role: '', serverPermissions: '*', canDelete: false });
  assert.ok(tabUniverse.every(tab => lib.canOpenTab(admin, tab)));
  assert.equal(lib.can(admin, 'delete_leads'), false);
});

test('the gate, the menu and the bars ask the one rule over the server\'s answer', () => {
  const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const hook = read('admin/hooks/useAccess.ts');
  assert.match(hook, /serverPermissions: authUser\?\.permissions/, 'the permissions are /api/auth/me\'s');
  const model = read('admin/pages/dashboard/shell/useDashboardModel.tsx');
  assert.match(model, /return visibleMenu\(groups, access\.viewer\);/);
  assert.doesNotMatch(model, /masterResolvePermissions|canUseChannel\(/);
  const container = read('admin/pages/dashboard/DashboardTabContainer.tsx');
  assert.match(container, /const allowed = canOpenTab\(activeTab\);/);
  assert.doesNotMatch(container, /import \{ TAB_PERMISSION_MAP \}/);
  assert.match(read('admin/pages/dashboard/tabs/SettingsHubTab.tsx'), /return canOpenTab\(entry\.tab\);/);
  const preview = read('admin/pages/staff-profile/StaffSettingsPanel.tsx');
  assert.match(preview, /canOpenTab\(viewer, item\.key\)/);
  assert.doesNotMatch(read('admin/pages/staff-profile/staffProfileConstants.ts'), /ACCESS_PREVIEW_TABS/);
});
