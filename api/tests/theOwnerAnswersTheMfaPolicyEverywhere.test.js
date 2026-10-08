'use strict';

// MED-18 of the 7 Oct 2026 audit: every guard asks the owner for the tenant's
// MFA policy except requireAdminOrStaff, so a route behind it alone let the
// owner — and an ADMIN-role account — through unverified once the policy was on.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-mfa-secret-0123456789-abcdefghijklmnopqrstuvw';
process.env.ADMIN_EMAILS = 'owner@x.test';

let policyOn = true;
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/mfaPolicy', {
  getMfaPolicy: async () => ({ enabled: policyOn, required_roles: ['admin'], required_permissions: [] }),
  policyRequiresStaff: (policy, staff) => policy.enabled && policy.required_roles.includes(String(staff?.role || '').toLowerCase()),
});
const { requireAdminOrStaff } = require('../middleware/auth');

async function pass(user) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let through = false;
  await requireAdminOrStaff({ user, tenantId: 'tenant-default' }, res, () => { through = true; });
  return { through, res };
}

test('the owner unverified is asked for MFA when the policy is on', async () => {
  policyOn = true;
  const { through, res } = await pass({ email: 'owner@x.test', uid: 'u-owner', tenant_id: 'tenant-default', mfa_enrolled: true, mfa_verified: false });
  assert.equal(through, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'MFA_REQUIRED');
});

test('verified, or with the policy off, the owner goes through', async () => {
  policyOn = true;
  assert.equal((await pass({ email: 'owner@x.test', uid: 'u-owner', tenant_id: 'tenant-default', mfa_verified: true })).through, true);
  policyOn = false;
  assert.equal((await pass({ email: 'owner@x.test', uid: 'u-owner', tenant_id: 'tenant-default', mfa_verified: false })).through, true);
});
