#!/usr/bin/env node
/**
 * Every screen whose menu gate is looser than the API behind it.
 *
 * That mismatch produces the worst version of a permission system: the person
 * is offered the screen, opens it, and the server refuses them. It is what
 * «خطأ في تحميل لوحة KPI: HTTP 403» and «Permission denied: view_leads» were,
 * and finding them one report at a time is how the last six were found.
 *
 * For each tab this resolves: the permission its menu entry is gated on, the
 * component it renders, the API paths that component (and the files it imports
 * from its own directory) calls, and the permission each of those routes
 * requires. A tab is reported when some role can open it and be refused.
 *
 * Reports the denominator, so "0 mismatches" means "none among N", not
 * "nothing was measured".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; } };

const walk = (dir, out = []) => {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js)$/.test(entry.name)) out.push(full);
  }
  return out;
};

// ── what every API route requires ───────────────────────────────────────────
const ROUTE_GUARDS = new Map();
for (const file of walk(path.join(ROOT, 'api', 'routes'))) {
  const source = fs.readFileSync(file, 'utf8');
  const re = /router\.(get|post|put|patch|delete)\s*\(\s*'([^']+)'\s*,([^\n]*)/g;
  let match;
  while ((match = re.exec(source))) {
    const [, , routePath, guards] = match;
    const permission = /requirePermission\('([a-z_]+)'\)/.exec(guards);
    const anyPermission = [...guards.matchAll(/requireAnyPermission\(([^)]*)\)/g)]
      .flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(p => p[1]));
    ROUTE_GUARDS.set(`${match[1].toUpperCase()} ${routePath}`, {
      adminOnly: /requireAdmin\b/.test(guards) && !/requireAdminOrStaff/.test(guards),
      superAdmin: /requireSuperAdmin/.test(guards),
      permissions: permission ? [permission[1]] : anyPermission,
    });
  }
}

/** The guard for a call, matched on verb and path together. */
const guardFor = (verb, called) => {
  const normalised = called.startsWith('/api') ? called : `/api${called}`;
  const exact = ROUTE_GUARDS.get(`${verb} ${normalised}`);
  if (exact) return exact;
  // A caller writes a concrete id where the route declares a parameter.
  const parts = normalised.split('/');
  for (const [key, guard] of ROUTE_GUARDS) {
    const [routeVerb, routePath] = key.split(' ');
    if (routeVerb !== verb) continue;
    const declared = routePath.split('/');
    if (declared.length !== parts.length) continue;
    if (declared.every((segment, i) => segment.startsWith(':') || segment === parts[i])) return guard;
  }
  return null;
};

// ── roles and what they hold ────────────────────────────────────────────────
const permissionsSource = read('admin/constants/permissions.ts');
const ROLE_PERMISSIONS = new Map();
{
  const start = permissionsSource.indexOf('ROLE_DEFAULT_PERMISSIONS');
  const body = permissionsSource.slice(start);
  const re = /\n {2}([a-z_]+): \[([^\]]*)\]/g;
  let match;
  while ((match = re.exec(body))) {
    ROLE_PERMISSIONS.set(match[1], new Set([...match[2].matchAll(/'([a-z_]+)'/g)].map(m => m[1])));
  }
}

// ── tabs: menu gate, and the component each renders ─────────────────────────
const shared = read('admin/pages/dashboard/dashboardShared.tsx');
const TAB_GATES = new Map();
for (const match of shared.matchAll(/\n {2}([a-z_0-9]+):\s*(\[[^\]]*\]|'[a-z_]+')/g)) {
  const permissions = [...match[2].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  if (permissions.length) TAB_GATES.set(match[1], permissions);
}

const navSource = read('admin/pages/dashboard/navigation.tsx');
const MENU_TABS = new Set([...navSource.matchAll(/key: '([a-z_0-9]+)', label:/g)].map(m => m[1]));

const TAB_COMPONENTS = new Map();
for (const file of ['admin/pages/dashboard/GeneralDashboardTabs.tsx',
  'admin/pages/dashboard/DashboardStandaloneTabs.tsx',
  'admin/pages/dashboard/DashboardDirectContentRoutes.tsx']) {
  const source = read(file);
  for (const match of source.matchAll(/key: '([a-z_0-9]+)', Component: ([A-Za-z]+)/g)) {
    TAB_COMPONENTS.set(match[1], match[2]);
  }
  for (const match of source.matchAll(/activeTab === '([a-z_0-9]+)'[\s\S]{0,300}?<([A-Z][A-Za-z]+)/g)) {
    if (!TAB_COMPONENTS.has(match[1])) TAB_COMPONENTS.set(match[1], match[2]);
  }
}

// ── the API paths a component calls, following its own-directory imports ────
const ADMIN_FILES = walk(path.join(ROOT, 'admin'));
const byBasename = new Map();
for (const file of ADMIN_FILES) byBasename.set(path.basename(file, path.extname(file)), file);

const apiWrapper = (() => {
  const source = read('admin/lib/mysqlapi.ts');
  const map = new Map();
  for (const match of source.matchAll(/(\w+):\s*(?:async )?\([^)]*\)\s*=>\s*(\w*)\(?\s*`?'?([/][a-zA-Z0-9/_${}.:-]+)([\s\S]{0,120}?method:\s*'(\w+)')?/g)) {
    const helper = match[2] || '';
    const verb = (match[5] || ({ post: 'POST', put: 'PUT', patch: 'PATCH', del: 'DELETE' })[helper] || 'GET').toUpperCase();
    map.set(match[1], { verb, path: match[3].replace(/\$\{[^}]*\}/g, 'x') });
  }
  return map;
})();

/**
 * Whether the handler that makes this call is itself behind a permission check
 * in the JSX. A button rendered inside {isAdmin && …} or {canManageX && …} is
 * not offered to someone who cannot use it, so the call is not a defect.
 *
 * Matched on the function that performs the call rather than on the call site,
 * because the fetch lives in a handler and the gate wraps the button that
 * invokes it. Deliberately shallow: it looks for a gate naming the same handler,
 * so an unrelated gate elsewhere in the file does not clear it.
 */
const gatedInJsx = (source, calledPath) => {
  const at = source.indexOf(calledPath.split('${')[0]);
  if (at < 0) return false;
  // The enclosing handler's name, taken from the nearest declaration above.
  const before = source.slice(0, at);
  const declaration = [...before.matchAll(/(?:const|function)\s+(\w+)\s*=?\s*(?:async\s*)?\(/g)].pop();
  if (!declaration) return false;
  const handler = declaration[1];
  // A gate wrapping something that calls that handler.
  const gate = new RegExp(`\\{\\s*(?:isAdmin|can[A-Z]\\w+)[\\s\\S]{0,400}?\\b${handler}\\b`);
  return gate.test(source);
};

const calledPaths = (componentName, seen = new Set()) => {
  const file = byBasename.get(componentName);
  if (!file || seen.has(file)) return [];
  seen.add(file);
  const source = fs.readFileSync(file, 'utf8');
  const markGated = call => ({ ...call, gated: gatedInJsx(source, call.path) });
  const clean = p => p.replace(/\$\{[^}]*\}/g, 'x').replace(/\?.*$/, '');
  const paths = [
    // A bare fetch with no method is a GET, which is what a screen's reads are.
    ...[...source.matchAll(/['"`](\/api\/[a-zA-Z0-9/_${}.:-]+)([\s\S]{0,160}?method:\s*'(\w+)')?/g)]
      .map(m => ({ verb: (m[3] || 'GET').toUpperCase(), path: clean(m[1]) })),
    ...[...source.matchAll(/admin(Get|Post|Put|Patch|Delete)<?[^(]*\(\s*[`'"]([/][a-zA-Z0-9/_${}.:-]+)/g)]
      .map(m => ({ verb: m[1].toUpperCase(), path: clean(m[2]) })),
    ...[...source.matchAll(/mysqlAdmin\.(\w+)\s*\(/g)]
      .map(m => apiWrapper.get(m[1])).filter(Boolean)
      .map(entry => ({ verb: entry.verb, path: clean(entry.path) })),
  ];

  const marked = paths.map(markGated);
  // Panels a screen is assembled from carry their own calls, and they live
  // beside it or in a subdirectory of their own.
  for (const match of source.matchAll(/from '\.\/(?:[A-Za-z0-9-]+\/)*([A-Za-z][A-Za-z0-9]*)'/g)) {
    marked.push(...calledPaths(match[1], seen));
  }
  return marked;
};

// ── report ──────────────────────────────────────────────────────────────────
const findings = [];
let examined = 0;

for (const [tab, gate] of TAB_GATES) {
  if (!MENU_TABS.has(tab)) continue;           // not offered in the menu
  const component = TAB_COMPONENTS.get(tab);
  if (!component) continue;
  examined += 1;

  const seenCall = new Set();
  const paths = calledPaths(component)
    .filter(call => call.path.startsWith('/api/admin') || call.path.startsWith('/admin'))
    .filter(call => {
      const key = `${call.verb} ${call.path}`;
      if (seenCall.has(key)) return false;
      seenCall.add(key);
      return true;
    });
  for (const [role, held] of ROLE_PERMISSIONS) {
    if (role === 'admin' || role === 'manager') continue;   // super admins bypass
    const opens = gate.some(permission => held.has(permission));
    if (!opens) continue;
    for (const call of paths) {
      const called = call.path;
      const guard = guardFor(call.verb, called);
      if (!guard) continue;
      if (call.gated) continue;   // clearly rendered behind a permission check
      const refused = guard.superAdmin || guard.adminOnly
        || (guard.permissions.length && !guard.permissions.some(p => held.has(p)));
      if (refused) {
        findings.push({
          tab, role, called: `${call.verb} ${called}`,
          needs: guard.superAdmin ? 'super admin' : guard.adminOnly ? 'admin' : guard.permissions.join(' or '),
          via: gate.filter(p => held.has(p)).join(', '),
        });
      }
    }
  }
}

const seen = new Set();
const unique = findings.filter(f => {
  const key = `${f.tab}|${f.role}|${f.called}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

console.log(`routes with a declared guard: ${ROUTE_GUARDS.size}`);
console.log(`roles: ${ROLE_PERMISSIONS.size}`);
console.log(`menu tabs with a gate and a component: ${examined}`);
console.log(`tabs where a role can open the screen and be refused inside: ${new Set(unique.map(f => f.tab)).size}`);
console.log('');
console.log('Each line is a call the role\'s permissions do not cover. It is a');
console.log('defect only when the control that makes the call is actually offered');
console.log('to them — a button already rendered behind {isAdmin && …} is fine,');
console.log('and this cannot always tell. Check the call site before acting.');
console.log('');

const byTab = new Map();
for (const finding of unique) {
  if (!byTab.has(finding.tab)) byTab.set(finding.tab, []);
  byTab.get(finding.tab).push(finding);
}
for (const [tab, rows] of [...byTab].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${tab}`);
  for (const row of rows.slice(0, 6)) {
    console.log(`      ${row.role} opens it via ${row.via} — ${row.called} needs ${row.needs}`);
  }
  if (rows.length > 6) console.log(`      … and ${rows.length - 6} more`);
}

process.exitCode = 0;
