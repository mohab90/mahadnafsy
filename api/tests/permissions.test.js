'use strict';
/**
 * Unit tests for RBAC resolution + runtime role overrides (security-critical).
 * Guarantees: per-user override wins; admin-set overrides apply to normal roles;
 * full-access roles can NEVER be locked out. Run: npm run test:unit
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePermissions, hasPermission, setRoleOverrides, getEffectiveRoleDefaults,
  FULL_ACCESS_ROLES,
} = require('../constants/permissions');

beforeEach(() => setRoleOverrides({})); // reset between tests

test('full-access roles bypass every permission check', () => {
  for (const role of FULL_ACCESS_ROLES) {
    assert.equal(hasPermission({ role }, 'manage_financial'), true);
    assert.equal(hasPermission({ role }, 'delete_subscribers'), true);
  }
});

test('a normal role only has its default permissions', () => {
  assert.equal(hasPermission({ role: 'sales' }, 'manage_leads'), true);
  assert.equal(hasPermission({ role: 'sales' }, 'manage_financial'), false);
});

test('per-user permissions_json override beats role default', () => {
  const staff = { role: 'sales', permissions_json: JSON.stringify(['view_dashboard']) };
  assert.deepEqual(resolvePermissions(staff), ['view_dashboard']);
  assert.equal(hasPermission(staff, 'manage_leads'), false);
});

test('admin role-override restricts a normal role at runtime', () => {
  setRoleOverrides({ sales: ['view_dashboard', 'view_leads'] });
  assert.equal(hasPermission({ role: 'sales' }, 'view_leads'), true);
  assert.equal(hasPermission({ role: 'sales' }, 'manage_leads'), false); // removed by override
});

test('override can NEVER restrict a full-access role (no self-lockout)', () => {
  setRoleOverrides({ admin: [], manager: [] }); // attempt to strip everything
  assert.equal(hasPermission({ role: 'admin' }, 'manage_financial'), true);
  assert.equal(hasPermission({ role: 'manager' }, 'delete_leads'), true);
  // getEffectiveRoleDefaults returns the hard-coded default, ignoring the override
  assert.notDeepEqual(getEffectiveRoleDefaults('admin'), []);
});

test('setRoleOverrides ignores malformed input safely', () => {
  setRoleOverrides(null);
  setRoleOverrides({ sales: 'not-an-array' });
  assert.equal(hasPermission({ role: 'sales' }, 'manage_leads'), true); // default restored
});
