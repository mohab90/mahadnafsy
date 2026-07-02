'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { extractCandidate } = require('../middleware/tenantContext');

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

test('port in host is ignored when reading the sub-domain', () => {
  const c = extractCandidate(req({ headers: { host: 'acme.mahad.app:65002' } }));
  assert.deepEqual(c, { value: 'acme', source: 'subdomain' });
});
