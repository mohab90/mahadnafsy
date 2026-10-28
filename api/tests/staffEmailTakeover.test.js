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
// Sign-up, «إنشاء حساب» and a client's credentials pointed at a staff address
// are each refused over HTTP, with nothing written, in
// tests/integration/staffAndAccounts.integration.test.js; so is an online
// manager deleting staff. What stays here is the assumption that makes the
// guard necessary.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// The guard, as the two routes that always had it write it.
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
