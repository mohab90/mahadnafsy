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
  FULL_ACCESS_ROLES, PERMISSIONS, DATA_SCOPE,
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

test('route-level permission tokens exist in the master permission registry', () => {
  const values = new Set(Object.values(PERMISSIONS));
  for (const token of ['manage_payments', 'bulk_whatsapp', 'approve_refunds']) {
    assert.equal(values.has(token), true, `${token} must be defined in PERMISSIONS`);
  }
});

test('professional role scopes keep staff on original data slices only', () => {
  assert.equal(DATA_SCOPE.sales, 'assigned_sales');
  assert.equal(DATA_SCOPE.collection, 'assigned_cs');
  assert.equal(DATA_SCOPE.support, 'assigned_cs');
  assert.equal(DATA_SCOPE.hr, 'none');
  assert.equal(DATA_SCOPE.trainer, 'none');
  assert.equal(DATA_SCOPE.instructor, 'none');
  assert.equal(DATA_SCOPE.online_manager, 'all');
  assert.equal(DATA_SCOPE.daqqi_manager, 'branch:DAQQI');
});

test('finance and messaging permissions are granted to the right operational roles', () => {
  assert.equal(hasPermission({ role: 'accountant' }, 'manage_payments'), true);
  assert.equal(hasPermission({ role: 'accountant' }, 'approve_refunds'), true);
  assert.equal(hasPermission({ role: 'sales' }, 'bulk_whatsapp'), true);
  assert.equal(hasPermission({ role: 'support' }, 'bulk_whatsapp'), true);
  assert.equal(hasPermission({ role: 'instructor' }, 'view_subscribers'), false);
  assert.equal(hasPermission({ role: 'hr' }, 'view_subscribers'), false);
});

test('sensitive modules are isolated from non-owner staff roles', () => {
  assert.equal(hasPermission({ role: 'sales' }, 'view_financial'), false);
  assert.equal(hasPermission({ role: 'sales' }, 'approve_refunds'), false);
  assert.equal(hasPermission({ role: 'support' }, 'manage_financial'), false);
  assert.equal(hasPermission({ role: 'accountant' }, 'manage_hr'), false);
  assert.equal(hasPermission({ role: 'hr' }, 'manage_payments'), false);
  assert.equal(hasPermission({ role: 'instructor' }, 'view_client_db'), false);
});

test('online manager remains an original-data role, not an isolated data copy', () => {
  assert.equal(DATA_SCOPE.online_manager, 'all');
  assert.equal(hasPermission({ role: 'online_manager' }, 'view_subscribers'), true);
  assert.equal(hasPermission({ role: 'online_manager' }, 'view_leads'), true);
  assert.equal(hasPermission({ role: 'online_manager' }, 'manage_financial'), true);
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
