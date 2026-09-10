'use strict';

// The permission matrix exists twice: api/constants/permissions.js guards the
// routes, admin/constants/permissions.ts builds the menu. When they disagree the
// symptom is always the same and always confusing — a tab is in the sidebar and
// the server answers 403, or a screen the employee needs is invisible while the
// route would have allowed it.
//
// Every "الصفحة بتفتح والسيرفر بيرفض" report in this system has been a version
// of that. Nothing checks the two files against each other, so this does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../constants/permissions');

const ROOT = path.join(__dirname, '..', '..');
const ADMIN_SOURCE = fs.readFileSync(
  path.join(ROOT, 'admin', 'constants', 'permissions.ts'), 'utf8'
);

/**
 * Load the admin matrix by stripping its TypeScript and evaluating it.
 *
 * The two files name the same tables differently — ROLE_PERMS/DATA_SCOPE on the
 * API side, ROLE_DEFAULT_PERMISSIONS/ROLE_DATA_SCOPE on the admin side — which
 * is part of why nobody noticed they could drift.
 */
const loadAdmin = () => {
  const js = require('node:module').stripTypeScriptTypes(ADMIN_SOURCE)
    .replace(/^export /gm, '')
    .replace(/\bas const\b/g, '');
  const module_ = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', `${js}\nmodule.exports = { ROLE_PERMS: ROLE_DEFAULT_PERMISSIONS, DATA_SCOPE: ROLE_DATA_SCOPE, FULL_ACCESS_ROLES };`)(
    module_, module_.exports
  );
  return module_.exports;
};

const sorted = list => (list === '*' ? '*' : [...list].sort());

test('both matrices define the same roles', () => {
  const admin = loadAdmin();
  const apiRoles = Object.keys(api.ROLE_PERMS).sort();
  const adminRoles = Object.keys(admin.ROLE_PERMS).sort();
  assert.ok(apiRoles.length >= 10, `expected the full role list, saw ${apiRoles.length}`);
  assert.deepEqual(adminRoles, apiRoles, 'a role in one file and not the other');
});

test('every role grants exactly the same permissions on both sides', () => {
  const admin = loadAdmin();
  const drift = [];
  for (const role of Object.keys(api.ROLE_PERMS)) {
    const left = sorted(api.ROLE_PERMS[role]);
    const right = sorted(admin.ROLE_PERMS[role] || []);
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      const onlyApi = left === '*' ? [] : left.filter(p => !right.includes(p));
      const onlyAdmin = right === '*' ? [] : right.filter(p => !left.includes(p));
      drift.push(`${role}: api-only=[${onlyApi}] admin-only=[${onlyAdmin}]`);
    }
  }
  assert.deepEqual(drift, [], 'the menu and the route guards disagree about who can do what');
});

test('the data scope table agrees too', () => {
  const admin = loadAdmin();
  // A permission with no matching scope is the other half of the same problem:
  // the tab opens, the route allows it, and every query returns nothing because
  // the role's scope is 'none'.
  const drift = [];
  for (const role of Object.keys(api.DATA_SCOPE)) {
    if (api.DATA_SCOPE[role] !== admin.DATA_SCOPE[role]) {
      drift.push(`${role}: api=${api.DATA_SCOPE[role]} admin=${admin.DATA_SCOPE[role]}`);
    }
  }
  assert.deepEqual(drift, []);
});

test('a sales rep can record a payment but not approve one', () => {
  // The grant that fixed "Permission denied: manage_payments" on booking.
  const sales = api.ROLE_PERMS.sales;
  assert.ok(sales.includes('manage_payments'), 'a rep cannot register the money they just closed');
  // The guard that makes it safe: without manage_financial the route stores the
  // payment as pending, and accounts approve it.
  assert.ok(!sales.includes('manage_financial'), 'a rep would be approving their own payments');
  assert.ok(!sales.includes('approve_refunds'));
});
