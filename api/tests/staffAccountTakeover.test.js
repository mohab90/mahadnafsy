'use strict';

// Resetting somebody else's password is not onboarding.
//
// POST /api/admin/staff-account and POST /api/admin/hr/applicants/:id/hire both
// look up an existing login by email and, if they find one, overwrite its
// password. An owner is recognised by email (ADMIN_EMAILS), and on production
// neither owner has MFA — so a new password set here is a new owner. Both routes
// guarded the *role* they would create and never looked at whose account the
// email already opened.
//
// Nobody below owner/manager holds manage_staff or manage_hr on production
// today (checked), so none of this was reachable yet. It was one settings
// change away: the `hr` role's own defaults include both.
//
// The hire route had a second door: STAFF_ROLES includes ADMIN and MANAGER, so
// manage_hr could hire someone straight into a full-access account.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');

const { assertGrantable, heldByTarget } = require('../lib/permissionGrant');
const { getEffectiveRoleDefaults } = require('../constants/permissions');

function handler(src, route, nextRoute) {
  const start = src.indexOf(route);
  assert.ok(start > 0, `route moved: ${route}`);
  const end = nextRoute ? src.indexOf(nextRoute, start + route.length) : -1;
  return src.slice(start, end > 0 ? end : start + 20000);
}

test('staff-account refuses to reset an owner, a manager, or a customer for a non-owner', () => {
  const h = handler(read('routes/auth.js'), "'/api/admin/staff-account'", '/api/admin/check-account');

  // All refusals come before the password is touched.
  const firstPasswordWrite = h.indexOf('UPDATE users SET password_hash');
  assert.ok(firstPasswordWrite > 0, 'the password write moved');
  for (const code of ['OWNER_REQUIRED_FOR_PRIVILEGED_ACCOUNT', 'CUSTOMER_ACCOUNT_REQUIRES_OWNER',
    'STAFF_TENANT_MISMATCH', 'STAFF_EMAIL_MISMATCH']) {
    const at = h.indexOf(code);
    assert.ok(at > 0, `staff-account lost the ${code} refusal`);
    assert.ok(at < firstPasswordWrite, `${code} is checked after the password has already been reset`);
  }
  assert.match(h, /ADMIN_EMAILS\.some\(e => String\(e\)\.toLowerCase\(\) === normalizedEmail\)/);
  // The owner/manager refusal code also appears in the staffId branch, so its
  // presence proves nothing — pin the condition that guards the email itself.
  const emailGuard = h.indexOf('if (ownerEmail || privilegedStaff) {');
  assert.ok(emailGuard > 0, 'the owner/manager email refusal is gone or no longer conditional on both');
  assert.ok(emailGuard < firstPasswordWrite);
  assert.match(h.slice(emailGuard, emailGuard + 200), /return refuse\(403,/);
  assert.match(h, /if \(existing\.length > 0 && !staffByEmail\)/);
  // The permission check sees what the employee already holds.
  assert.match(h, /assertGrantable\(req, req\.body, \{\s*alreadyHeld: heldByTarget\(/);
});

test('staff-account releases its connection exactly once', () => {
  // An early return that also called conn.release() ran the finally's release
  // too — handing one connection back to the pool twice.
  const h = handler(read('routes/auth.js'), "'/api/admin/staff-account'", '/api/admin/check-account');
  const releases = h.match(/conn\.release\(\)/g) || [];
  assert.equal(releases.length, 1, `expected one release, found ${releases.length}`);
  assert.match(h, /\} finally \{ conn\.release\(\); \}/);
});

test('hiring refuses a privileged role and someone else\'s login for a non-owner', () => {
  const h = handler(read('routes/hr/talent.js'), "'/api/admin/hr/applicants/:appId/hire'", null);
  const passwordWrite = h.indexOf('UPDATE users SET password_hash');
  assert.ok(passwordWrite > 0);
  const roleGuard = h.indexOf("!req.isSuperAdmin && (role === 'ADMIN' || role === 'MANAGER')");
  const loginGuard = h.indexOf('LOGIN_BELONGS_TO_ANOTHER_ACCOUNT');
  assert.ok(roleGuard > 0, 'manage_hr can hire straight into ADMIN or MANAGER again');
  assert.ok(loginGuard > 0, 'hiring can reset another account\'s password again');
  assert.ok(roleGuard < passwordWrite && loginGuard < passwordWrite, 'a guard runs after the password write');
  // Reusing a login is still allowed when it is the applicant's own address —
  // a former student being hired is the case the reuse exists for.
  assert.match(h, /loginOwner && loginEmail !== applicantEmail/);
});

test('staff.js will not let a non-owner rewrite a manager\'s row or widen data scope', () => {
  const src = read('routes/staff.js');
  assert.match(src, /existingStaff && !req\.isSuperAdmin\s*&& PRIVILEGED_ROLES\.includes/);
  assert.match(src, /!req\.isSuperAdmin && dataScope !== null\s*&& dataScope !== normalizeDataScope\(existingStaff\?\.data_scope\)/);
});

// ── the permission context, run for real ─────────────────────────────────

const hrReq = { isSuperAdmin: false, staffRecord: { role: 'hr', tenant_id: 'tenant-default' } };
const hrOwn = new Set(getEffectiveRoleDefaults('hr', 'tenant-default'));
const salesDefaults = getEffectiveRoleDefaults('sales', 'tenant-default');
const salesOnly = salesDefaults.find(p => !hrOwn.has(p));

test('premise: sales defaults include something hr does not hold', () => {
  assert.ok(salesOnly, 'role defaults changed; pick another pair for these tests');
});

test('re-sending an employee\'s existing permissions is not a new grant', () => {
  // The "create login" screen sends the whole staff record back.
  const existingStaff = { role: 'sales', permissions_json: JSON.stringify([salesOnly]) };
  const without = assertGrantable(hrReq, { permissions: [salesOnly] });
  const withContext = assertGrantable(hrReq, { permissions: [salesOnly] },
    { alreadyHeld: heldByTarget({ existingStaff, tenantId: 'tenant-default' }) });
  assert.equal(without.ok, false, 'premise: without context this is an overreach');
  assert.equal(withContext.ok, true, 'hr could not create a login for an employee whose permissions it does not hold');
});

test('the chosen role\'s defaults are not a new grant', () => {
  const result = assertGrantable(hrReq, { permissions: salesDefaults },
    { alreadyHeld: heldByTarget({ role: 'sales', tenantId: 'tenant-default' }) });
  assert.equal(result.ok, true);
});

test('anything beyond what the target holds is still refused', () => {
  const extra = [...require('../lib/permissionGrant').ALL_PERMISSIONS]
    .find(p => !hrOwn.has(p) && !salesDefaults.includes(p));
  assert.ok(extra, 'premise: some permission is outside both hr and sales');
  const result = assertGrantable(hrReq, { permissions: [...salesDefaults, extra] },
    { alreadyHeld: heldByTarget({ role: 'sales', tenantId: 'tenant-default' }) });
  assert.equal(result.ok, false);
  assert.deepEqual(result.body.error.includes(extra), true);
});

test('a role whose defaults are "*" contributes nothing to what is held', () => {
  // Otherwise naming ADMIN as the role would exempt every permission — the
  // privileged-role guards decide who may assign that, not this helper.
  assert.deepEqual(heldByTarget({ role: 'admin', tenantId: 'tenant-default' }), []);
});
