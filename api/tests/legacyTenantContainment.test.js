'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  legacyTenantContainment,
  LEGACY_UNSCOPED_PATHS,
} = require('../middleware/legacyTenantContainment');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

function invoke(req) {
  let nextCalled = false;
  const response = { statusCode: 200, body: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(body) { response.body = body; return this; },
  };
  legacyTenantContainment(req, res, () => { nextCalled = true; });
  return { nextCalled, ...response };
}

test('legacy tenant path inventory is non-empty', () => {
  assert.ok(LEGACY_UNSCOPED_PATHS.length >= 10);
});

test('default tenant can use contained legacy routes', () => {
  const result = invoke({ tenantId: DEFAULT_TENANT, path: '/api/admin/hr/employees' });
  assert.equal(result.nextCalled, true);
});

test('additional tenants fail closed on unscoped legacy routes', () => {
  const result = invoke({ tenantId: 'tenant-acme', path: '/api/admin/community/posts' });
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'TENANT_SCOPE_NOT_AVAILABLE');
});

test('tenant-scoped HR routes are available to additional tenants', () => {
  const result = invoke({ tenantId: 'tenant-acme', path: '/api/admin/hr/employees' });
  assert.equal(result.nextCalled, true);
  assert.equal(result.statusCode, 200);
});

test('additional tenants continue to explicitly scoped routes', () => {
  const result = invoke({ tenantId: 'tenant-acme', path: '/api/me/orders' });
  assert.equal(result.nextCalled, true);
});

test('missing tenant context always fails closed', () => {
  const result = invoke({ path: '/api/me/orders' });
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'TENANT_CONTEXT_REQUIRED');
});
