#!/usr/bin/env node
// Every tab in the admin nav must be drawable, and every key in a data-loading
// set must name a real screen.
//
// Two failure modes, both silent, both found by hand on 2026-08-26 only because
// a number on screen looked wrong:
//
//   1. A tab whose container is gated by a Set that does not contain its key.
//      Clicking it changes the URL and draws nothing — no content, no request,
//      no error, and the component's chunk is never fetched. أرشيف العملاء and
//      الفروع both did this.
//
//   2. A key in a loading set that names no screen. fullCrmDataTabs held
//      'marketing', which is the nav group header above the screen — whose key
//      is 'marketing_hub'. The load effect matches on the active tab key, so it
//      never fired, and the marketing hub reported "500 ليدات جديدة" against
//      27,000. 'analytics' and 'crm_settings' named nothing at all.
//
// Neither shows up in TypeScript, the test suite, or a bundle grep: the code
// compiles, ships, and runs. It simply never matches.
//
//   node tools/dashboard-tab-audit.mjs [--list]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DASH_DIR = path.join(ROOT, 'admin/pages/dashboard');
const DASHBOARD = path.join(ROOT, 'admin/pages/Dashboard.tsx');
const VERBOSE = process.argv.includes('--list');

// Comments quote tab keys constantly — including the ones documenting this very
// check. Stripping them is what stops the audit flagging its own explanation.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(line => {
      // A // outside a string literal. Good enough here: these files never put
      // a bare // inside a quoted key.
      const i = line.indexOf('//');
      if (i === -1) return line;
      const before = line.slice(0, i);
      const quotes = (before.match(/'/g) || []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join('\n');
}

const read = f => stripComments(fs.readFileSync(f, 'utf8'));

// ── the four gating sets ────────────────────────────────────────────────────
const groups = read(path.join(DASH_DIR, 'dashboardTabGroups.ts'));

function setMembers(name) {
  const i = groups.indexOf(`export const ${name}`);
  if (i === -1) return null;
  const open = groups.indexOf('[', i);
  // Match the closing bracket of this literal, not the first ] in the file.
  let depth = 0, j = open;
  for (; j < groups.length; j++) {
    if (groups[j] === '[') depth++;
    else if (groups[j] === ']' && --depth === 0) break;
  }
  return new Set([...groups.slice(open, j).matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]));
}

const GATES = {
  DashboardDirectContentRoutes: setMembers('directContentTabs'),
  DashboardSaasOpsTabs: setMembers('saasOpsTabs'),
  DashboardGrowthOpsTabs: setMembers('growthOpsTabs'),
  DashboardContentHubRoutes: setMembers('contentHubRouteTabs'),
};

// GeneralDashboardTabs is drawn inside DashboardContentHubRoutes, so its keys
// inherit that gate rather than having one of their own.
const INHERITS = { GeneralDashboardTabs: 'DashboardContentHubRoutes' };

// ── which keys anything can draw ────────────────────────────────────────────
const drawnBy = new Map();
const claim = (key, container) =>
  drawnBy.set(key, [...(drawnBy.get(key) || []), container]);

for (const file of fs.readdirSync(DASH_DIR).filter(f => f.endsWith('.tsx'))) {
  const src = read(path.join(DASH_DIR, file));
  const container = path.basename(file, '.tsx');
  for (const m of src.matchAll(/activeTab\s*===\s*'([a-z_0-9]+)'/g)) claim(m[1], container);
  for (const m of src.matchAll(/\{\s*key:\s*'([a-z_0-9]+)'\s*,\s*Component/g)) claim(m[1], container);
  // A third form: ['courses','lectures',…].includes(activeTab) — one component
  // serving several keys. Dashboard.tsx draws six tabs this way, and missing it
  // reported all six as unreachable.
  for (const m of src.matchAll(/\[([^\]]*?)\]\s*\.includes\(activeTab\)/g))
    for (const k of m[1].matchAll(/'([a-z_0-9]+)'/g)) claim(k[1], container);
}

// Dashboard.tsx draws a number of tabs itself; those are ungated by definition.
{
  const src = read(DASHBOARD);
  for (const m of src.matchAll(/activeTab\s*===\s*'([a-z_0-9]+)'/g)) claim(m[1], 'Dashboard');
  for (const m of src.matchAll(/\[([^\]]*?)\]\s*\.includes\(activeTab\)/g))
    for (const k of m[1].matchAll(/'([a-z_0-9]+)'/g)) claim(k[1], 'Dashboard');
}

// ── the nav ─────────────────────────────────────────────────────────────────
const nav = read(path.join(DASH_DIR, 'navigation.tsx'));

// A group header owns an items array; a leaf is a screen. Only leaves have to
// be drawable — a header is a label that expands a submenu.
// Find each items array and take the key of the object that owns it. Matching
// key…items as one span instead let a group's last child swallow the next
// group's marker, so both were misfiled — which is how ask_ai, a screen, got
// reported as a group header.
const groupKeys = new Set();
for (const m of nav.matchAll(/items:\s*\[/g)) {
  const key = [...nav.slice(0, m.index).matchAll(/key:\s*'([a-z_0-9]+)'/g)].pop();
  if (key) groupKeys.add(key[1]);
}
const leaves = [...nav.matchAll(/\{\s*key:\s*'([a-z_0-9]+)'\s*,\s*label:\s*'([^']+)'/g)]
  .map(m => ({ key: m[1], label: m[2] }))
  .filter(t => !groupKeys.has(t.key));

const reachable = (key) => {
  const owners = drawnBy.get(key);
  if (!owners) return false;
  return owners.some(c => {
    const gate = GATES[INHERITS[c] || c];
    return !gate || gate.has(key);
  });
};

// ── findings ────────────────────────────────────────────────────────────────
const unreachable = leaves.filter(t => !reachable(t.key));

// ── the e2e screen list ─────────────────────────────────────────────────────
// e2e/tests/dashboard-screens.spec.ts opens every screen and asserts it draws
// something. A list that drifts from the nav is a test that quietly stops
// covering the screens it was written for — the failure mode being guarded
// against here, one level up.
const SPEC = path.join(ROOT, 'e2e/tests/dashboard-screens.spec.ts');
let specGap = [];
if (fs.existsSync(SPEC)) {
  const spec = fs.readFileSync(SPEC, 'utf8');
  const from = spec.indexOf('const SCREENS');
  const listed = new Set([...spec.slice(from, spec.indexOf('];', from))
    .matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]));
  specGap = leaves.filter(t => !listed.has(t.key))
    .map(t => ({ key: t.key, detail: `"${t.label}" — in the nav but not in the e2e screen list` }));
}
const LOAD_SETS = ['fullCrmDataTabs', 'fullLeadTabs', 'fullSubscriberTabs'];
const deadKeys = [];
for (const name of LOAD_SETS) {
  const keys = setMembers(name);
  if (!keys) continue;
  for (const key of keys) {
    if (groupKeys.has(key)) deadKeys.push({ set: name, key, why: 'nav group header, not a screen' });
    else if (!drawnBy.has(key)) deadKeys.push({ set: name, key, why: 'no container draws it' });
  }
}

/** The quality gate imports this; running the file prints the same findings. */
export function scanDashboardTabs() {
  return [
    ...unreachable.map(t => {
      const owners = drawnBy.get(t.key);
      const gate = owners ? (INHERITS[owners[0]] || owners[0]) : null;
      return {
        key: t.key,
        detail: owners
          ? `"${t.label}" — drawn by ${owners.join(',')} but its gate excludes it (${gate})`
          : `"${t.label}" — no container draws it`,
      };
    }),
    ...deadKeys.map(d => ({ key: d.key, detail: `in ${d.set} — ${d.why}` })),
    ...specGap,
  ];
}

export const navLeafCount = leaves.length;

// Only report when run directly. Imported, it stays quiet and returns findings.
const RUN_DIRECTLY = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (!RUN_DIRECTLY) {
  // nothing printed on import
} else if (VERBOSE) {
  console.log(`nav leaves: ${leaves.length}   group headers: ${groupKeys.size}   drawable keys: ${drawnBy.size}`);
  for (const name of LOAD_SETS) {
    const keys = setMembers(name);
    console.log(`  ${name}: ${keys ? [...keys].join(', ') || '(empty)' : '(missing)'}`);
  }
}

if (RUN_DIRECTLY) {
  for (const t of unreachable) {
  const owners = drawnBy.get(t.key);
  const gate = owners ? (INHERITS[owners[0]] || owners[0]) : null;
  console.log(`  ✗ ${t.key.padEnd(24)} "${t.label}" — ${owners ? `drawn by ${owners.join(',')} but its gate excludes it (${gate})` : 'no container draws it'}`);
}
  for (const d of [...deadKeys, ...specGap.map(g => ({ key: g.key, set: 'e2e', why: g.detail }))]) {
  console.log(`  ✗ ${d.key.padEnd(24)} in ${d.set} — ${d.why}`);
}

}

const total = unreachable.length + deadKeys.length + specGap.length;
if (RUN_DIRECTLY) console.log(total === 0
  ? `  ✓  dashboard tabs: every one of ${leaves.length} nav entries is drawable, and every loading-set key names a screen`
  : `  ✗  dashboard tabs: ${unreachable.length} unreachable, ${deadKeys.length} dead loading key(s), ${specGap.length} missing from the e2e list`);

if (RUN_DIRECTLY) process.exit(total === 0 ? 0 : 1);
