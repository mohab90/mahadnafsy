'use strict';

// Nobody hands out a permission they were not given.
//
// Four routes wrote `staff.permissions_json` and each checked something
// different. The worst was POST /api/admin/staff-account, which took the list
// straight into the INSERT: `manage_staff` is meant to be the right to onboard
// staff — the route's own comment says so about roles, and blocks ADMIN and
// MANAGER — but permissions are a separate axis, and that route would mint an
// account holding anything in the system, with a password the creator chooses.
//
// The second was subtler. staff.js did check, but it tested
// `Array.isArray(s.permissions)` while the value it actually stored came from
// `s.permissions_json`. Sending the identical list as a JSON string walked past
// the guard and into the database. A check that reads a different field from
// the one that gets written is not a check.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');

const { assertGrantable, readRequestedPermissions, ALL_PERMISSIONS } = require('../lib/permissionGrant');
const { PERMISSIONS } = require('../constants/permissions');

// A caller holding exactly these.
const staffReq = (permissions, { isSuperAdmin = false } = {}) => ({
  isSuperAdmin,
  staffRecord: { role: 'other', permissions_json: JSON.stringify(permissions) },
});

const MANAGE_STAFF = PERMISSIONS.MANAGE_STAFF || 'manage_staff';
const VIEW_FINANCIAL = PERMISSIONS.VIEW_FINANCIAL || 'view_financial';

test('a request that does not mention permissions grants none', () => {
  const result = assertGrantable(staffReq([MANAGE_STAFF]), {});
  assert.equal(result.ok, true);
  // null, not '[]' — an empty array would claim an explicit grant of nothing,
  // and resolvePermissions reads null as "use the role defaults".
  assert.equal(result.permissionsJson, null);
});

test('an emptied grid stores "[]" — revoking everything is an edit like any other', () => {
  // NULL and '[]' used to be the same thing here, and resolvePermissions read
  // both as "use the role defaults". So an admin who unticked every box saved
  // successfully and reopened the page to find the role's twelve permissions
  // back: the one edit the grid could not express was revoking everything.
  // NULL now means only "this request said nothing about permissions".
  for (const body of [{ permissions: [] }, { permissions_json: '[]' }, { permissions_json: '' }]) {
    const result = assertGrantable(staffReq([MANAGE_STAFF]), body);
    assert.equal(result.ok, true);
    assert.equal(result.permissionsJson, '[]',
      `an emptied grid was stored as ${result.permissionsJson} for ${JSON.stringify(body)}`);
  }
  // A request that never mentioned permissions still leaves the stored value be.
  assert.equal(assertGrantable(staffReq([MANAGE_STAFF]), { name: 'no permissions field' }).permissionsJson, null);
});

test('a stored empty list resolves to no permissions, not to the role defaults', () => {
  const { resolvePermissions } = require('../constants/permissions');
  assert.deepEqual(resolvePermissions({ role: 'hr', permissions_json: '[]' }), []);
  // NULL still falls back, which is what every existing row relies on.
  assert.ok(resolvePermissions({ role: 'hr', permissions_json: null }).length > 0);
  // And a full-access role is never locked out by an empty list.
  const { hasPermission } = require('../constants/permissions');
  assert.equal(hasPermission({ role: 'admin', permissions_json: '[]' }, 'manage_staff'), true);
});

test('a permission the caller holds may be passed on', () => {
  const result = assertGrantable(staffReq([MANAGE_STAFF]), { permissions: [MANAGE_STAFF] });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.permissionsJson), [MANAGE_STAFF]);
});

test('a permission the caller does not hold is refused', () => {
  const result = assertGrantable(staffReq([MANAGE_STAFF]), { permissions: [VIEW_FINANCIAL] });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'PERMISSION_OVERREACH');
});

test('the JSON-string form is checked exactly like the array form', () => {
  // This is the bypass: same list, different field, and the old guard in
  // staff.js read `permissions` while storing `permissions_json`.
  const asArray = assertGrantable(staffReq([MANAGE_STAFF]), { permissions: [VIEW_FINANCIAL] });
  const asString = assertGrantable(staffReq([MANAGE_STAFF]), { permissions_json: JSON.stringify([VIEW_FINANCIAL]) });
  assert.equal(asArray.ok, false);
  assert.equal(asString.ok, false, 'permissions_json walked past the overreach check');
  assert.equal(asString.body.code, 'PERMISSION_OVERREACH');
});

test('an unknown permission is refused, not silently dropped', () => {
  // Dropping it quietly means the desk thinks it granted something it did not.
  const result = assertGrantable(staffReq([MANAGE_STAFF], { isSuperAdmin: true }),
    { permissions: [MANAGE_STAFF, 'manage_stafff'] });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'PERMISSIONS_UNKNOWN');
  assert.match(result.body.error, /manage_stafff/);
});

test('malformed input is a 400, never an empty grant', () => {
  for (const body of [{ permissions: 'not json at all' }, { permissions_json: '{"a":1}' }, { permissions: 42 }]) {
    const result = assertGrantable(staffReq([MANAGE_STAFF], { isSuperAdmin: true }), body);
    assert.equal(result.ok, false, `accepted malformed: ${JSON.stringify(body)}`);
    assert.equal(result.status, 400);
  }
});

test('a super-admin is exempt from the overreach rule but not from the name check', () => {
  const granted = assertGrantable(staffReq([], { isSuperAdmin: true }), { permissions: [VIEW_FINANCIAL] });
  assert.equal(granted.ok, true);
  const typo = assertGrantable(staffReq([], { isSuperAdmin: true }), { permissions: ['not_a_permission'] });
  assert.equal(typo.ok, false);
});

test('a caller with full access may grant anything that exists', () => {
  // resolvePermissions returns '*' for the full-access roles; that must widen
  // the grantable set rather than being compared as a literal string.
  const req = { isSuperAdmin: false, staffRecord: { role: 'admin' } };
  const result = assertGrantable(req, { permissions: [VIEW_FINANCIAL, MANAGE_STAFF] });
  assert.equal(result.ok, true, 'a full-access role could not grant a permission it holds');
});

test('duplicates collapse', () => {
  const result = assertGrantable(staffReq([MANAGE_STAFF]), { permissions: [MANAGE_STAFF, MANAGE_STAFF] });
  assert.deepEqual(JSON.parse(result.permissionsJson), [MANAGE_STAFF]);
});

test('readRequestedPermissions tells "absent" apart from "empty"', () => {
  assert.equal(readRequestedPermissions({}), undefined);
  assert.deepEqual(readRequestedPermissions({ permissions: [] }), []);
  assert.deepEqual(readRequestedPermissions({ permissions_json: '' }), []);
  assert.equal(readRequestedPermissions({ permissions: 'oops' }), null);
});

test('every route that writes permissions_json goes through the helper', () => {
  const writers = [
    ['routes/auth.js', 'staff-account'],
    ['routes/staff.js', 'staff create'],
    ['routes/hr/talent.js', 'hire from applicant'],
  ];
  for (const [rel, what] of writers) {
    const src = read(rel);
    assert.match(src, /assertGrantable\(req,/, `${what} (${rel}) does not call assertGrantable`);
    // And none of them may rebuild the value by hand afterwards.
    assert.ok(!/permissions_json\s*\|\|\s*\(Array\.isArray/.test(src),
      `${rel} still builds permissions_json without the helper`);
  }

  // hr/employees.js takes the stricter route — super-admin only — and keeps it.
  const employees = read('routes/hr/employees.js');
  assert.match(employees, /PERMISSIONS_REQUIRE_SUPERADMIN/);
});

test('the master list is the one in constants/permissions.js', () => {
  assert.ok(ALL_PERMISSIONS.size > 5);
  for (const value of Object.values(PERMISSIONS)) {
    assert.ok(ALL_PERMISSIONS.has(value), `${value} is missing from the grantable set`);
  }
});
