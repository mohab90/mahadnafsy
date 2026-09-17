'use strict';

// Who counts as a full-access caller, and where that is decided.
//
// Four guards in middleware/auth.js resolve a staff record. Three of them raised
// `req.isSuperAdmin` for a full-access role; requireAdminOrStaff — the one that
// admits every staff member, and the guard on most of the admin API — did not.
// Eighteen refusals downstream read that flag to decide whether the caller may
// act, so an account whose role is ADMIN or MANAGER was refused:
//
//   * the permission grid and the data-scope picker on the staff page
//     (403 PERMISSIONS_REQUIRE_SUPERADMIN — reproduced against staging, where a
//     role=admin caller could not change one permission on one employee);
//   * creating a staff row in a privileged role, or a login with a password;
//   * the Dokki round controls.
//
// The only way to hold that authority was to have your email written into an
// environment variable on the server — which is why the institute's own
// managers could edit a permission grid all day and change nothing.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const auth = fs.readFileSync(path.join(API, 'middleware', 'auth.js'), 'utf8');

/** The body of one guard function, from its declaration to the next one. */
function guardBody(name) {
  const start = auth.indexOf(`async function ${name}(`);
  assert.ok(start > 0, `${name} is gone from middleware/auth.js`);
  const next = auth.indexOf('\nasync function ', start + 1);
  const end = auth.indexOf('\nfunction ', start + 1);
  const stop = [next, end].filter(i => i > 0).sort((a, b) => a - b)[0] || auth.length;
  return auth.slice(start, stop);
}

test('every guard that resolves a staff record raises a full-access role', () => {
  for (const guard of ['requireAdmin', 'requireAdminOrOnlineManager', 'requireAdminOrOnlineManagerOrCollection', 'requireAdminOrStaff']) {
    const body = guardBody(guard);
    assert.match(body, /findActiveStaff/, `${guard} no longer looks the caller up`);
    // The property, not the spelling: after the lookup, a full-access role
    // raises the flag. Each guard writes that differently.
    const afterLookup = body.slice(body.indexOf('findActiveStaff'));
    assert.match(afterLookup, /FULL_ACCESS_ROLES/,
      `${guard} decides authority from the environment list alone — an ADMIN or MANAGER account is refused`);
    assert.match(afterLookup, /req\.isSuperAdmin = true/, `${guard} never raises the flag for the role it just read`);
  }
});

test('the roles that carry full access are the two the product calls top', () => {
  const { FULL_ACCESS_ROLES, DATA_SCOPE } = require('../constants/permissions');
  assert.deepEqual([...FULL_ACCESS_ROLES].sort(), ['admin', 'manager']);
  // Raising the flag for them changes no data boundary: it is what they had.
  assert.equal(DATA_SCOPE.admin, 'all');
  assert.equal(DATA_SCOPE.manager, 'all');
});

test('the permission grid is gated on that flag, not on a role string', () => {
  const employees = fs.readFileSync(path.join(API, 'routes', 'hr', 'employees.js'), 'utf8');
  assert.match(employees, /sentAccessFields && !req\.isSuperAdmin/);
  assert.match(employees, /PERMISSIONS_REQUIRE_SUPERADMIN/);
});

test('an HR account sees no client data until someone gives it a scope', () => {
  // Asked directly: is the HR account empty? It is, by the role's own default —
  // `hr` scopes to 'none', so every lead and subscriber query filters to nothing
  // whatever the permission grid says. staff.data_scope is the override, and
  // setting it is exactly the edit that was returning 403.
  const { DATA_SCOPE, resolveDataScope, normalizeDataScope } = require('../constants/permissions');
  assert.equal(DATA_SCOPE.hr, 'none');
  assert.equal(resolveDataScope({ role: 'hr' }), 'none');
  assert.equal(resolveDataScope({ role: 'hr', data_scope: 'all' }), 'all');
  assert.equal(resolveDataScope({ role: 'hr', data_scope: 'branch:DAQQI' }), 'branch:DAQQI');
  // Collection work needs the money permissions too; the HR defaults carry none.
  const { ROLE_PERMS } = require('../constants/permissions');
  assert.ok(!ROLE_PERMS.hr.includes('view_financial'));
  assert.ok(!ROLE_PERMS.hr.includes('view_leads'));
  assert.equal(normalizeDataScope('nonsense'), null);
});
