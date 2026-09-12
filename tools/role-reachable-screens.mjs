#!/usr/bin/env node
/**
 * How many screens each role can actually reach.
 *
 * A role that can sign in and open nothing is a real state — «other» is meant
 * to be close to that — but it is also what a mis-keyed gate looks like, and
 * the two are indistinguishable until someone counts. This counts.
 *
 * Six roles get a horizontal CompactRoleNav instead of the sidebar; for those
 * the answer is simply what their bar lists, which tools/role-bar-gate-scan.mjs
 * separately checks they can open.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const { ROLE_PERMS, DATA_SCOPE, FULL_ACCESS_ROLES } = require_(path.join(ROOT, 'api/constants/permissions.js'));

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

const gates = codeOnly(read('admin/pages/dashboard/dashboardShared.tsx'));
const navigation = codeOnly(read('admin/pages/dashboard/navigation.tsx'));
const barsSource = codeOnly(read('admin/pages/dashboard/DashboardNavigation.tsx'));

const gateFor = (tab) => {
  const match = gates.match(new RegExp('\\b' + tab + ":\\s*(\\[[^\\]]*\\]|'[a-z_]+')"));
  if (!match) return null;
  return (match[1].match(/'([a-z_]+)'/g) || []).map(s => s.replace(/'/g, ''));
};

const sidebarTabs = [...new Set([...navigation.matchAll(/\{ key: '([a-z_]+)'/g)].map(m => m[1]))];

const BAR_ROLE = {
  isSalesOnly: 'sales',
  isCollectionRole: 'collection',
  isReceptionDaqqi: 'reception_daqqi',
  isDaqqiManager: 'daqqi_manager',
  isOnlineManager: 'online_manager',
  isSalesCollectionManager: 'sales_collection_manager',
};

const barTabs = {};
{
  let current = null;
  let depth = 0;
  for (const line of barsSource.split('\n')) {
    if (!current) {
      const opener = /\{(is[A-Za-z]+) &&/.exec(line);
      if (opener && BAR_ROLE[opener[1]]) { current = { role: BAR_ROLE[opener[1]], tabs: [] }; depth = 0; }
    }
    if (!current) continue;
    for (const ch of line) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
    }
    for (const m of line.matchAll(/\{ key: '([a-z_]+)'/g)) current.tabs.push(m[1]);
    if (depth <= 0) {
      if (current.tabs.length) barTabs[current.role] = [...new Set(current.tabs)];
      current = null;
    }
  }
}

const rows = [];
for (const [role, perms] of Object.entries(ROLE_PERMS)) {
  if (perms === '*' || FULL_ACCESS_ROLES.includes(role)) {
    rows.push({ role, nav: 'sidebar', count: 'all', scope: DATA_SCOPE[role], tabs: [] });
    continue;
  }
  const held = new Set(perms);
  const usesBar = Boolean(barTabs[role]);
  const tabs = usesBar
    ? barTabs[role]
    : sidebarTabs.filter((tab) => {
      const allowed = gateFor(tab);
      return allowed !== null && allowed.some(p => held.has(p));
    });
  rows.push({ role, nav: usesBar ? 'bar' : 'sidebar', count: tabs.length, scope: DATA_SCOPE[role] || '?', tabs });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows));
  process.exit(0);
}

console.log('role'.padEnd(26) + 'nav'.padEnd(10) + 'screens'.padEnd(9) + 'data scope');
console.log('-'.repeat(72));
for (const row of rows) {
  const flag = row.count === 0 ? '   ← reaches nothing' : '';
  console.log(
    row.role.padEnd(26) + row.nav.padEnd(10) + String(row.count).padEnd(9) + String(row.scope).padEnd(18) + flag
  );
}
if (process.argv.includes('--tabs')) {
  console.log('');
  for (const row of rows) {
    if (!row.tabs.length) continue;
    console.log(`${row.role}: ${row.tabs.join(', ')}`);
  }
}
