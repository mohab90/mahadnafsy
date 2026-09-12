#!/usr/bin/env node
// The third navigation surface.
//
// StaffHomeTab renders a row of quick-action buttons on «ملفي الشخصي» — the page
// every employee lands on. Each one navigates to a tab key, and nothing checks
// those keys against the role's permissions: the sidebar is filtered at render
// time and the role bars now have their own scan, but these are a third
// hand-written list.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const { ROLE_PERMS, FULL_ACCESS_ROLES } = require_(path.join(ROOT, 'api/constants/permissions.js'));

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const codeOnly = s => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .split('\n').map(l => l.replace(/(^|\s)\/\/[^\n]*/, '$1')).join('\n');

const gates = codeOnly(read('admin/pages/dashboard/dashboardShared.tsx'));
const home = codeOnly(read('admin/pages/dashboard/tabs/StaffHomeTab.tsx'));

const gateFor = tab => {
  const m = gates.match(new RegExp('\\b' + tab + ":\\s*(\\[[^\\]]*\\]|'[a-z_]+')"));
  return m ? (m[1].match(/'([a-z_]+)'/g) || []).map(x => x.replace(/'/g, '')) : null;
};

// The base list every role gets.
const baseBlock = home.slice(home.indexOf('const base = ['), home.indexOf('];', home.indexOf('const base = [')));
const base = [...baseBlock.matchAll(/tab: '([a-z_]+)'/g)].map(m => m[1]);

// The role-conditional additions.
const extra = [];
for (const m of home.matchAll(/if \(\[([^\]]+)\]\.includes\(role\)\) \{\s*base\.unshift\(\{[^}]*tab: '([a-z_]+)'/g)) {
  const roles = [...m[1].matchAll(/'([a-z_]+)'/g)].map(r => r[1]);
  extra.push({ roles, tab: m[2] });
}

const findings = [];
for (const [role, perms] of Object.entries(ROLE_PERMS)) {
  if (perms === '*' || FULL_ACCESS_ROLES.includes(role)) continue;
  const held = new Set(perms);
  const offered = [...base, ...extra.filter(e => e.roles.includes(role)).map(e => e.tab)];
  for (const tab of offered) {
    const allowed = gateFor(tab);
    if (allowed === null) { findings.push(`${role} · ${tab} — no gate (the sidebar would hide it)`); continue; }
    if (!allowed.some(p => held.has(p))) {
      findings.push(`${role} · ${tab} — needs ${allowed.join(' or ')}, role holds none`);
    }
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ base, extra: extra.length, findings }));
  process.exit(0);
}

console.log(`base actions (every role): ${base.join(', ')}`);
console.log(`role-conditional actions : ${extra.length}`);
console.log('');
console.log(`quick actions offered to a role that cannot open them: ${findings.length}`);
findings.forEach(f => console.log('  ' + f));
