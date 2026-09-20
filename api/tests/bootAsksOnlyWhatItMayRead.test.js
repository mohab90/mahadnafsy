'use strict';

// The panel's first load asks only for what the account may read.
//
// Every page load requested seventeen admin-wide lists whatever the account.
// For the Dokki manager all seventeen were refused — 403, three times over for
// three screens — and a refused list sets nothing, so skipping it changes
// nothing on screen. The browser sweep of the Dokki screens found them the
// first time it actually opened those screens.
//
// The danger in skipping is the opposite mistake: skipping a list the account
// could have read. So each skipped call is traced to its route, and the route
// must be one only an admin passes — requireAdmin, which the panel's
// authUser.isAdmin mirrors exactly (routes/auth.js computes both the same way).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const runtime = read('admin/context/site-data-hooks/useAdminDataRuntime.ts');
const client = read('admin/lib/mysqlapi.ts');

function routeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}
const routes = routeFiles(path.join(ROOT, 'api', 'routes')).map(file => fs.readFileSync(file, 'utf8')).join('\n');

const skipped = [...runtime.matchAll(/adminOnly\(\(\) => (mysqlAdmin|mysqlCatalog)\.(\w+)\(/g)].map(m => m[2]);

test('the admin-only lists are skipped for everyone else', () => {
  assert.ok(skipped.length >= 2, `expected the admin-only reads to go through adminOnly, found ${skipped.join(', ')}`);
  assert.ok(runtime.includes("isAdmin ? load() : Promise.reject("), 'adminOnly must decide on authUser.isAdmin');
});

// fn → the permission the route it calls asks for.
function routeGuardFor(fn) {
  const lines = client.split('\n');
  const at = lines.findIndex(l => new RegExp(`^\\s+${fn}:`).test(l));
  assert.ok(at >= 0, `${fn} is not in the admin API client`);
  // Some entries wrap, so the path sits on the next line.
  const line = lines.slice(at, at + 3).join(' ');
  const route = (/[`'](\/admin\/[\w/-]+)/.exec(line) || [])[1];
  assert.ok(route, `${fn}: no /admin route in «${line.trim()}»`);
  const handler = routes.split('\n').find(l => l.includes(`router.get('/api${route}',`));
  assert.ok(handler, `${fn}: GET /api${route} not found in api/routes`);
  return { route, handler, permission: (/requirePermission\('([a-z_]+)'\)/.exec(handler) || [])[1] };
}

test('every skipped list is one the server gives to admins only', () => {
  for (const fn of skipped) {
    const { route, handler } = routeGuardFor(fn);
    assert.ok(/requireAuth, requireAdmin[,)]/.test(handler),
      `${fn} → GET /api${route} is open to staff — skipping it would hide data they may read: ${handler.trim().slice(0, 140)}`);
  }
});

test('a list a permission opens is asked for when the account holds it', () => {
  // These used to be skipped for everyone but an admin, back when only an
  // admin could read them. They carry permissions now, so skipping them would
  // hide from a content or reception account exactly what it was given — and
  // asking for all of them regardless is the 403-per-page-load this file
  // exists to prevent. So the boot asks by permission, which /api/auth/me now
  // tells the panel before the first request goes out.
  const gated = [...runtime.matchAll(/permitted\('([a-z_]+)'\)\s*\?\s*\(?\s*(?:withTimeout\()?(mysqlAdmin|mysqlCatalog)\.(\w+)\(/g)]
    .map(m => ({ permission: m[1], fn: m[3] }));
  assert.ok(gated.length >= 8, `expected the delegated lists to be asked for by permission, found ${JSON.stringify(gated)}`);
  for (const { permission, fn } of gated) {
    const { route, permission: routeWants } = routeGuardFor(fn);
    assert.equal(permission, routeWants,
      `${fn} is fetched behind «${permission}» but GET /api${route} asks for «${routeWants}»`);
  }
  assert.ok(runtime.includes('authUser.permissions'), 'the permissions must come from the signed-in account');
});

test('content goes straight to the public copy for everyone but an admin', () => {
  assert.ok(runtime.includes('mysqlAdmin.getContent(isAdmin)'));
  const getter = client.slice(client.indexOf('getContent:'), client.indexOf('getDiscounts:'));
  assert.ok(getter.includes("apiFetch<AR>('/content')"), 'the public copy is the fallback');
});

test('the management messages bell shows only for those who can read it', () => {
  const nav = read('admin/pages/dashboard/DashboardNavigation.tsx');
  const line = nav.split('\n').find(l => l.includes('<MessagesBell mode="management"'));
  assert.ok(line && line.includes("hasPermission(currentStaff, 'view_hr')"), `the bell is unconditional: ${line && line.trim()}`);
  assert.ok(routes.includes("router.get('/api/admin/hr/staff-messages/inbox', requireAuth, requireAdminOrStaff, requirePermission('view_hr'),"),
    'the bell must be gated on what its route requires');
});
