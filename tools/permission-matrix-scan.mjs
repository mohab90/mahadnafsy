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

export function scanPermissionMatrix() {
  const unguardedStaffRoutes = [];
  const unknownRoutePermissions = [];
  for (const file of walk(join(ROOT, 'api/routes'))) {
    const source = readFileSync(file, 'utf8');
    const routePattern = /router\.(get|post|put|patch|delete)\(\s*(['"`])(\/api\/(?:admin|staff)\/[^'"`]+)\2([\s\S]*?)async\s*\(/g;
    let route;
    while ((route = routePattern.exec(source))) {
      const middleware = route[4];
      if (/requireAdminOrStaff/.test(middleware)
        && !/requirePermission|requireAnyPermission|requireAdmin\b|requireSuperAdmin|requirePlatformAdmin|requireAdminOrOnlineManager/.test(middleware)) {
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
  const mappedTabs = new Map(
    [...tabMap.matchAll(/^\s*([a-z_]+):\s*'([a-z_]+)'/gm)].map(match => [match[1], match[2]])
  );
  const unmappedTabs = tabKeys.filter(key => !mappedTabs.has(key));
  const unknownTabPermissions = [...mappedTabs]
    .filter(([, permission]) => !validPermissions.has(permission))
    .map(([tab, permission]) => `${tab}:${permission}`);

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
  console.log(`Permission matrix: ${result.routeFiles} route files, ${result.tabCount} dashboard tabs, ${failures.reduce((sum, [, values]) => sum + values.length, 0)} violation(s)`);
  if (failures.length) process.exitCode = 1;
}
