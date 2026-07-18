'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { DEFAULT_TENANT, extractCandidate, extractSignedTenant, resolveTenant } = require('../middleware/tenantContext');

const req = (over = {}) => ({ headers: {}, ...over });

test('subdomain slug is used as the tenant candidate', () => {
  const c = extractCandidate(req({ headers: { host: 'acme.mahad.app' } }));
  assert.deepEqual(c, { value: 'acme', source: 'subdomain' });
});

test('reserved sub-domains (www/app/api/admin) are NOT tenants', () => {
  for (const h of ['www.mahad.app', 'app.mahad.app', 'api.mahad.app', 'admin.mahad.app']) {
    assert.equal(extractCandidate(req({ headers: { host: h } })), null, h);
  }
});

test('apex/2-label host yields no candidate (single-tenant)', () => {
  assert.equal(extractCandidate(req({ headers: { host: 'mahad.app' } })), null);
  assert.equal(extractCandidate(req({ headers: { host: 'localhost:3001' } })), null);
});

test('X-Tenant-Id header overrides the sub-domain', () => {
  const c = extractCandidate(req({ headers: { host: 'acme.mahad.app', 'x-tenant-id': 'beta' } }));
  assert.deepEqual(c, { value: 'beta', source: 'header' });
});

test('JWT tenant claim wins over both header and sub-domain', () => {
  const c = extractCandidate(req({ headers: { host: 'acme.mahad.app', 'x-tenant-id': 'beta' }, user: { tid: 'gamma' } }));
  assert.deepEqual(c, { value: 'gamma', source: 'jwt' });
});

test('tenant_id user claim is accepted as a canonical JWT candidate', () => {
  const c = extractCandidate(req({ headers: {}, user: { tenant_id: 'tenant-acme' } }));
  assert.deepEqual(c, { value: 'tenant-acme', source: 'jwt' });
});

test('a valid legacy token without tenant claim is confined to default tenant', () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'unit-test-secret-for-tenant-context';
  try {
    const token = jwt.sign({ uid: 'legacy-user' }, process.env.JWT_SECRET);
    assert.equal(extractSignedTenant(req({ headers: { authorization: `Bearer ${token}` } })), DEFAULT_TENANT);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('legacy token resolves default without requiring the tenants table', async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'unit-test-secret-for-tenant-context';
  try {
    const token = jwt.sign({ uid: 'legacy-user' }, process.env.JWT_SECRET);
    const request = req({ headers: { authorization: `Bearer ${token}`, 'x-tenant-id': 'tenant-attacker' } });
    let continued = false;
    await resolveTenant(request, {}, () => { continued = true; });
    assert.equal(continued, true);
    assert.equal(request.tenantId, DEFAULT_TENANT);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('port in host is ignored when reading the sub-domain', () => {
  const c = extractCandidate(req({ headers: { host: 'acme.mahad.app:65002' } }));
  assert.deepEqual(c, { value: 'acme', source: 'subdomain' });
});

test('IPv4 localhost is not treated as a tenant sub-domain', () => {
  assert.equal(extractCandidate(req({ headers: { host: '127.0.0.1:3001' } })), null);
});
