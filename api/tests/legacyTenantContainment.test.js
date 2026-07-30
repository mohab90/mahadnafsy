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

test('tenant-native accounting routes are available to additional tenants', () => {
  for (const path of ['/api/admin/accounting/chart-of-accounts', '/api/admin/fx-rates/refresh']) {
    const result = invoke({ tenantId: 'tenant-acme', path });
    assert.equal(result.nextCalled, true, path);
    assert.equal(result.statusCode, 200, path);
  }
});

test('tenant-scoped community routes are available to additional tenants', () => {
  const admin = invoke({ tenantId: 'tenant-acme', path: '/api/admin/community/posts' });
  const publicFeed = invoke({ tenantId: 'tenant-acme', path: '/api/community/posts' });
  assert.equal(admin.nextCalled, true);
  assert.equal(publicFeed.nextCalled, true);
});

test('tenant-scoped HR routes are available to additional tenants', () => {
  const result = invoke({ tenantId: 'tenant-acme', path: '/api/admin/hr/employees' });
  assert.equal(result.nextCalled, true);
  assert.equal(result.statusCode, 200);
});

test('tenant-scoped CRM utilities and payment documents are available to additional tenants', () => {
  for (const path of [
    '/api/admin/leads/scoring',
    '/api/admin/leads/due-today',
    '/api/admin/leads/gsheet-sync',
    '/api/admin/leads/lead-1/utm',
    '/api/admin/payments/pay-1/invoice-html',
    '/api/admin/payments/due-upcoming',
    '/api/admin/notifications',
    '/api/admin/notifications/inbox',
    '/api/admin/automation-workflows',
    '/api/admin/automation-workflows/run',
    '/api/admin/crm/stale-leads',
    '/api/admin/crm/follow-up-due',
    '/api/admin/crm/leads/lead-1/status',
    '/api/admin/crm/leads/lead-1/interactions',
    '/api/admin/crm/leads/smart-route',
  ]) {
    const result = invoke({ tenantId: 'tenant-acme', path });
    assert.equal(result.nextCalled, true, path);
  }
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
