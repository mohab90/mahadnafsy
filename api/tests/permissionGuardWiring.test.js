'use strict';
/**
 * requirePermission and requireAnyPermission read req.staffRecord and
 * req.isSuperAdmin. requireAuth sets neither — only the requireAdmin* /
 * requireStaff family does. A route that goes straight from requireAuth to
 * requirePermission therefore answers 403 "Staff record not found" to every
 * caller, the owner included, and does it in about five milliseconds because
 * nothing has touched the database yet.
 *
 * POST /api/admin/staff was wired that way, so adding an employee from the HR
 * screen had never once worked. It was the only one of 362. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROUTES_DIR = path.join(__dirname, '..', 'routes');
const SETTER = /require(Admin|AdminOrStaff|AdminOrOnlineManager|AdminOrOnlineManagerOrCollection|Staff|StaffOrAdmin)\b/;

function routeFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function permissionGuardedRoutes() {
  const guarded = [];
  for (const file of routeFiles(ROUTES_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    const re = /router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2\s*,/g;
    let match;
    while ((match = re.exec(source)) !== null) {
      const after = source.slice(match.index);
      const stop = after.search(/\basync\b|\(req,\s*res\)/);
      if (stop < 0) continue;
      const guards = after.slice(0, stop);
      if (!/require(Any)?Permission\s*\(/.test(guards)) continue;
      guarded.push({
        where: `${path.relative(ROUTES_DIR, file)}:${source.slice(0, match.index).split('\n').length}`,
        route: `${match[1].toUpperCase()} ${match[3]}`,
        resolvesIdentity: SETTER.test(guards),
      });
    }
  }
  return guarded;
}

test('every permission-guarded route first resolves who is calling', () => {
  const guarded = permissionGuardedRoutes();
  // Denominator, so a zero here means "none of these", not "nothing was read".
  assert.ok(guarded.length > 300, `expected the whole route surface, counted ${guarded.length}`);

  const unreachable = guarded.filter(r => !r.resolvesIdentity);
  assert.deepEqual(unreachable.map(r => `${r.where} ${r.route}`), [],
    'these routes refuse everyone, including the owner, with "Staff record not found"');
});

test('the route that was broken is wired like the other 361', () => {
  const staff = fs.readFileSync(path.join(ROUTES_DIR, 'staff.js'), 'utf8');
  const create = staff.slice(staff.indexOf("router.post('/api/admin/staff'"));
  const guards = create.slice(0, create.indexOf('async'));
  assert.ok(guards.includes('requireAdminOrStaff'), 'the guard that loads the staff record');
  assert.ok(guards.indexOf('requireAdminOrStaff') < guards.indexOf('requirePermission'),
    'and it has to run before the permission is checked');
});
