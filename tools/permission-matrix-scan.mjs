#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { PERMISSIONS } = require(join(ROOT, 'api/constants/permissions.js'));
const validPermissions = new Set(Object.values(PERMISSIONS));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }).filter(file => file.endsWith('.js'));
}

const GUARD_PATTERN = /requirePermission|requireAnyPermission|requireAdmin\b|requireSuperAdmin|requirePlatformAdmin|requireAdminOrOnlineManager/;

// Guard lists are frequently hoisted into a shared array and spread into the
// route (`const view = [requireAuth, requireAdminOrStaff, requirePermission(..)]`
// … `router.get(path, ...view, handler)`). Read those back so a spread reads
// the same as the inline form to everything below.
function guardArrays(source) {
  const arrays = new Map();
  for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*\[([^\]]*?)\];/g)) {
    if (/require(?:Auth|AdminOrStaff|Permission|AnyPermission)/.test(match[2])) arrays.set(match[1], match[2]);
  }
  return arrays;
}

function expandGuards(middleware, arrays) {
  let expanded = middleware;
  for (const [name, body] of arrays) expanded = expanded.split(`...${name}`).join(body);
  return expanded;
}

export function scanPermissionMatrix() {
  const unguardedStaffRoutes = [];
  const unknownRoutePermissions = [];
  let staffRoutesExamined = 0;
  for (const file of walk(join(ROOT, 'api/routes'))) {
    const source = readFileSync(file, 'utf8');
    const arrays = guardArrays(source);
    // Every mounted route, not just /api/admin|staff. The old pattern anchored
    // on those two prefixes, so POST /api/messaging/channels/:id/test — staff
    // authenticated, no permission named — was never examined and the scan
    // still reported a closed matrix. What makes a route in scope is the guard
    // it carries, not the words in its path.
    const routePattern = /router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2([\s\S]*?)async\s*\(/g;
    let route;
    while ((route = routePattern.exec(source))) {
      const middleware = expandGuards(route[4], arrays);
      if (!/requireAdminOrStaff/.test(middleware)) continue;
      staffRoutesExamined++;
      if (!GUARD_PATTERN.test(middleware)) {
        unguardedStaffRoutes.push(`${relative(ROOT, file)}:${route[1].toUpperCase()} ${route[3]}`);
      }
    }
    for (const match of source.matchAll(/require(?:Any)?Permission\(([^)]*)\)/g)) {
      for (const token of match[1].matchAll(/['"]([a-z_]+)['"]/g)) {
        if (!validPermissions.has(token[1])) {
          unknownRoutePermissions.push(`${relative(ROOT, file)}:${token[1]}`);
        }
      }
    }
  }

  const navigation = readFileSync(join(ROOT, 'admin/pages/dashboard/navigation.tsx'), 'utf8');
  const dashboard = readFileSync(join(ROOT, 'admin/pages/dashboard/dashboardShared.tsx'), 'utf8');
  const frontendPermissions = readFileSync(join(ROOT, 'admin/constants/permissions.ts'), 'utf8');
  const tabType = navigation.match(/export type TabKey =([\s\S]*?);/)?.[1] || '';
  const tabMap = dashboard.match(/const TAB_PERMISSION_MAP[\s\S]*?= \{([\s\S]*?)\n\};/)?.[1] || '';
  const tabKeys = [...tabType.matchAll(/'([^']+)'/g)].map(match => match[1]);
  // A tab names one permission, or a list of them where any one opens it. The
  // list form arrived with the merged screens: التكاملات holds seven that were
  // gated four different ways. Reading only the single form counted both merged
  // tabs as unmapped — which is the loudest way for this scan to be wrong, since
  // it reports a permission hole exactly where the gate got broader, not weaker.
  const mappedTabs = new Map(
    [...tabMap.matchAll(/^\s*([a-z_]+):\s*(\[[^\]]*\]|'[a-z_]+')/gm)].map(match => [
      match[1],
      [...match[2].matchAll(/'([a-z_]+)'/g)].map(inner => inner[1]),
    ])
  );
  const unmappedTabs = tabKeys.filter(key => !mappedTabs.has(key));
  const unknownTabPermissions = [...mappedTabs]
    .flatMap(([tab, permissions]) => permissions
      .filter(permission => !validPermissions.has(permission))
      .map(permission => `${tab}:${permission}`));

  const frontendRegistry = frontendPermissions.match(/export const PERMISSIONS = \{([\s\S]*?)\} as const/)?.[1] || '';
  const frontendTokens = new Set([...frontendRegistry.matchAll(/:\s*'([a-z_]+)'/g)].map(match => match[1]));
  const permissionRegistryDrift = [
    ...[...validPermissions].filter(token => !frontendTokens.has(token)).map(token => `missing-frontend:${token}`),
    ...[...frontendTokens].filter(token => !validPermissions.has(token)).map(token => `missing-backend:${token}`),
  ];

  return {
    unguardedStaffRoutes,
    unknownRoutePermissions,
    unmappedTabs,
    unknownTabPermissions,
    permissionRegistryDrift,
    routeFiles: walk(join(ROOT, 'api/routes')).length,
    // Reported so "0 violations" can be read against how much was actually
    // looked at. The previous scan examined 328 staff routes and called the
    // matrix closed; 64 more existed that it never opened.
    staffRoutesExamined,
    tabCount: tabKeys.length,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = scanPermissionMatrix();
  const failures = Object.entries(result).filter(([, value]) => Array.isArray(value) && value.length);
  if (process.argv.includes('--list')) {
    for (const [group, values] of failures) {
      console.log(`${group}:`);
      values.forEach(value => console.log(`  ${value}`));
    }
  }
  console.log(`Permission matrix: ${result.routeFiles} route files, ${result.staffRoutesExamined} staff routes examined, ${result.tabCount} dashboard tabs, ${failures.reduce((sum, [, values]) => sum + values.length, 0)} violation(s)`);
  if (failures.length) process.exitCode = 1;
}
