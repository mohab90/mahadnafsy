'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_TENANT_ID,
  findActiveStaff,
  getTrustedTenantId,
  tenantIdFromPayload,
} = require('../lib/authTenant');
const { resolveTenantId } = require('../lib/tenantScope');

test('legacy tokens are confined to the canonical default tenant', () => {
  assert.equal(tenantIdFromPayload({ uid: 'legacy-user' }), DEFAULT_TENANT_ID);
  assert.equal(getTrustedTenantId({ tenantId: DEFAULT_TENANT_ID }, DEFAULT_TENANT_ID), DEFAULT_TENANT_ID);
  assert.equal(getTrustedTenantId({ tenantId: 'tenant-acme' }, DEFAULT_TENANT_ID), null);
});

test('a signed tenant cannot cross the canonical request tenant', () => {
  assert.equal(getTrustedTenantId({ tenantId: 'tenant-acme' }, 'tenant-acme'), 'tenant-acme');
  assert.equal(getTrustedTenantId({ tenantId: 'tenant-acme' }, 'tenant-beta'), null);
});

test('staff lookup scopes both SQL and parameters to the trusted tenant', async () => {
  let captured;
  const expected = { id: 'staff-1', role: 'sales', tenant_id: 'tenant-acme' };
  const staff = await findActiveStaff(
    { tenantId: 'tenant-acme', user: { tenant_id: 'tenant-acme' } },
    ' Sales@Example.com ',
    {
      query: async (sql, params) => {
        captured = { sql, params };
        return [[expected]];
      },
    },
  );

  assert.equal(staff, expected);
  assert.match(captured.sql, /FROM staff[\s\S]*WHERE tenant_id = \?/);
  assert.deepEqual(captured.params, ['tenant-acme', 'sales@example.com']);
});

test('cross-tenant staff lookup fails closed without querying the database', async () => {
  let queried = false;
  const staff = await findActiveStaff(
    { tenantId: 'tenant-acme', user: { tenant_id: 'tenant-beta' } },
    'manager@example.com',
    { query: async () => { queried = true; return [[null]]; } },
  );
  assert.equal(staff, null);
  assert.equal(queried, false);
});

test('tenant feature scope ignores an unvalidated raw tenant header', () => {
  assert.equal(resolveTenantId({ headers: { 'x-tenant-id': 'tenant-attacker' } }), DEFAULT_TENANT_ID);
  assert.equal(resolveTenantId({ tenantId: 'tenant-acme', headers: { 'x-tenant-id': 'tenant-attacker' } }), 'tenant-acme');
  assert.equal(resolveTenantId({ user: { tenant_id: 'tenant-beta' }, headers: { 'x-tenant-id': 'tenant-attacker' } }), 'tenant-beta');
});

test('auth middleware contains no direct unscoped staff lookup', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'auth.js'), 'utf8');
  assert.equal(/FROM\s+staff/i.test(source), false);
  assert.match(source, /findActiveStaff\(req, email/);
});
