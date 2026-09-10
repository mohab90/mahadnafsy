#!/usr/bin/env node
/**
 * Every tab a role's own nav bar offers it, against what that role may open.
 *
 * Six roles do not get the sidebar. They get a horizontal CompactRoleNav in
 * DashboardNavigation.tsx with a hand-written list of tabs — and nothing
 * checked that list against the role's permissions, because the sidebar is
 * filtered by TAB_PERMISSION_MAP at render time and these are not.
 *
 * That is how «إحصائياتي» sat in the sales bar pointing at `overview`, which is
 * gated on view_financial. The rep clicked their own statistics every day and
 * got «غير مصرح بالوصول». tools/permission-mismatch-scan.mjs walks the sidebar
 * and would never have seen it.
 *
 * A tab in a role's bar has to be openable by that role. That is the whole
 * check.
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
  .map(line => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

// The flag each bar is rendered behind, and the role it means. Mirrors
// admin/pages/dashboard/hooks/useCurrentStaff.ts.
const BAR_ROLE = {
  isSalesOnly: 'sales',
  isCollectionRole: 'collection',
  isReceptionDaqqi: 'reception_daqqi',
  isDaqqiManager: 'daqqi_manager',
  isOnlineManager: 'online_manager',
  isSalesCollectionManager: 'sales_collection_manager',
};

const nav = codeOnly(read('admin/pages/dashboard/DashboardNavigation.tsx'));
const gates = codeOnly(read('admin/pages/dashboard/dashboardShared.tsx'));

/** The permissions a tab is gated on — one, several, or none at all. */
const gateFor = tab => {
  const match = gates.match(new RegExp(`\\b${tab}:\\s*(\\[[^\\]]*\\]|'[a-z_]+')`));
  if (!match) return null;
  return (match[1].match(/'([a-z_]+)'/g) || []).map(s => s.replace(/'/g, ''));
};

// Walk the file, tracking which bar we are inside, and collect its tab keys.
const lines = nav.split('\n');
const bars = [];
let current = null;
let depth = 0;
for (const line of lines) {
  if (!current) {
    const opener = /\{(is[A-Za-z]+) &&/.exec(line);
    if (opener && BAR_ROLE[opener[1]]) { current = { flag: opener[1], tabs: [] }; depth = 0; }
  }
  if (!current) continue;
  for (const ch of line) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
  }
  for (const m of line.matchAll(/\{ key: '([a-z_]+)', label: '([^']*)'/g)) {
    current.tabs.push({ key: m[1], label: m[2] });
  }
  if (depth <= 0 && current.tabs.length) { bars.push(current); current = null; }
  else if (depth <= 0) current = null;
}

const findings = [];
for (const bar of bars) {
  const role = BAR_ROLE[bar.flag];
  const grants = ROLE_PERMS[role];
  if (grants === '*' || FULL_ACCESS_ROLES.includes(role)) continue;
  const held = new Set(grants || []);
  for (const { key, label } of bar.tabs) {
    const allowed = gateFor(key);
    if (allowed === null) {
      findings.push({ role, key, label, why: 'the tab has no gate, so the sidebar would hide it' });
      continue;
    }
    if (!allowed.some(p => held.has(p))) {
      findings.push({
        role, key, label,
        why: `needs ${allowed.join(' or ')} — the role holds none of them`,
      });
    }
  }
}

// A permission that cannot return a row is the same defect wearing a different
// hat: the tab opens and the screen is empty.
const NEEDS_ROWS = ['view_leads', 'view_subscribers', 'view_client_db', 'view_orders', 'view_financial'];
const scopeless = [];
for (const [role, grants] of Object.entries(ROLE_PERMS)) {
  if (grants === '*') continue;
  if ((DATA_SCOPE[role] || 'none') !== 'none') continue;
  const held = grants.filter(p => NEEDS_ROWS.includes(p));
  if (held.length) scopeless.push({ role, held });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ bars: bars.length, findings, scopeless }));
  process.exit(0);
}

console.log(`role bars found: ${bars.length}`);
for (const bar of bars) console.log(`  ${BAR_ROLE[bar.flag].padEnd(26)} ${bar.tabs.length} tabs`);
console.log('');
console.log(`tabs a role is offered and cannot open: ${findings.length}`);
for (const f of findings) console.log(`  ${f.role} · «${f.label}» (${f.key}) — ${f.why}`);
console.log('');
console.log(`roles granted a data permission their scope cannot serve: ${scopeless.length}`);
for (const s of scopeless) console.log(`  ${s.role} holds ${s.held.join(', ')} with data scope 'none'`);
