'use strict';
// A staff address must not be given a login by anyone but the staff screens.
//
// Every privileged check in this system resolves the caller's staff record by
// EMAIL ALONE — findActiveStaff and _resolveStaffByUser both match on the
// address with no uid. That is safe only while nobody else can put a password
// on a staff address, which is why /api/auth/register and /api/user/signup have
// refused it since the identity work.
//
// Two routes were written without that guard, and both are reachable by
// online_manager — a role requireSuperAdmin deliberately excludes so it cannot
// escalate:
//
//   POST /api/admin/create-account          — creates a login on any address
//   PUT  /api/admin/subscribers/:id/credentials — moves a login onto any address
//
// Six staff rows on production are active with no login row of their own, among
// them a MANAGER and a DAQQI_MANAGER, and an online manager can read the staff
// list because the role holds view_staff. So: pick the manager's address,
// create an account on it with a chosen password, sign in, and findActiveStaff
// hands back the manager's row and with it isSuperAdmin. Full tenant takeover.
// MFA does not intervene — the policy is off by default and does not cover this
// role in any case.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const auth = codeOnly(read('routes/auth.js'));

// The guard, as the two routes that always had it write it.
const GUARD = /SELECT id FROM staff WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\) COLLATE utf8mb4_unicode_ci = \? AND is_active = 1/;

function handlerFor(needle) {
  const at = auth.indexOf(needle);
  assert.ok(at > 0, `${needle} not found`);
  const rest = auth.slice(at);
  const end = rest.indexOf('\n});');
  return rest.slice(0, end === -1 ? rest.length : end);
}

test('the four routes that can put a password on an address all refuse a staff one', () => {
  for (const [route, needle] of [
    ['POST /api/auth/register', "'/api/auth/register'"],
    ['POST /api/user/signup', "'/api/user/signup'"],
    ['POST /api/admin/create-account', "'/api/admin/create-account'"],
    ['PUT /api/admin/subscribers/:id/credentials', "'/api/admin/subscribers/:id/credentials'"],
  ]) {
    const handler = handlerFor(needle);
    assert.match(handler, GUARD, `${route} must check the staff table`);
    assert.match(handler, /ADMIN_EMAILS\.some/, `${route} must also refuse an owner address`);
    assert.match(handler, /STAFF_INVITATION_REQUIRED/, `${route} must say why`);
  }
});

test('the guard is checked before the account is written', () => {
  // A check after the INSERT protects nothing.
  for (const needle of ["'/api/admin/create-account'", "'/api/admin/subscribers/:id/credentials'"]) {
    const handler = handlerFor(needle);
    const guardAt = handler.search(GUARD);
    const writeAt = Math.min(
      ...['INSERT INTO users', 'UPDATE users SET']
        .map(sql => handler.indexOf(sql))
        .filter(at => at > 0)
        .concat([Number.MAX_SAFE_INTEGER])
    );
    assert.ok(guardAt > 0, 'guard not found');
    assert.ok(guardAt < writeAt, 'the staff check must run before any write to users');
  }
});

test('why the guard matters: privilege still resolves by email alone', () => {
  // If this ever stops being true the guard can be reconsidered. While it holds,
  // an address is an identity, and handing one out is handing out the role.
  const tenant = codeOnly(read('lib/authTenant.js'));
  assert.match(tenant, /LOWER\(TRIM\(email\)\) COLLATE utf8mb4_unicode_ci = \?/);
  assert.doesNotMatch(tenant, /firebase_uid/,
    'findActiveStaff matches on the address only — that is the assumption being protected');

  const middleware = codeOnly(read('../api/middleware/auth.js'));
  assert.match(middleware, /FULL_ACCESS_ROLES\.includes/,
    'a matched staff row with a full-access role is what grants isSuperAdmin');
});

test('online_manager is excluded from super-admin, which is the point', () => {
  // The role is trusted with customers, not with the system. The two routes
  // above handed it the system anyway.
  const middleware = codeOnly(read('../api/middleware/auth.js'));
  const superAdmin = middleware.slice(middleware.indexOf('function requireSuperAdmin'));
  assert.doesNotMatch(superAdmin.slice(0, 900), /online_manager/);
});
