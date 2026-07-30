'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isPlatformAdminIdentity } = require('../lib/platformAccess');

test('platform administrator identity is explicit and normalized', () => {
  const allowlist = { emails: ['owner@example.com'], uids: ['platform-uid'] };
  assert.equal(isPlatformAdminIdentity({ email: ' Owner@Example.com ' }, allowlist), true);
  assert.equal(isPlatformAdminIdentity({ uid: 'platform-uid' }, allowlist), true);
  assert.equal(isPlatformAdminIdentity({ email: 'tenant-admin@example.com' }, allowlist), false);
});

test('SaaS control plane never accepts tenant super-admin middleware', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'saas-admin.js'), 'utf8');
  assert.match(source, /requirePlatformAdmin/);
  assert.doesNotMatch(source, /requireSuperAdmin/);
  const protectedRoutes = source.match(/router\.(?:get|post|patch|put|delete)\([^;]+requirePlatformAdmin/gs) || [];
  assert.equal(protectedRoutes.length, 10);
});

test('platform access is fail-closed when its audit trail is unavailable', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'auth.js'), 'utf8');
  assert.match(source, /platform_access_granted/);
  assert.match(source, /PLATFORM_AUDIT_REQUIRED/);
  assert.match(source, /await writeAuditEvent/);
});
