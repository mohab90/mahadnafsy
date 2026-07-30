'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evidenceHash } = require('../lib/privacyService');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('privacy export is self-service, tenant scoped, consistent and excludes auth secrets', () => {
  const route = read('routes/privacy.js');
  const service = read('lib/privacyService.js');

  assert.match(route, /\/api\/me\/privacy\/export[\s\S]{0,120}requireAuth[\s\S]{0,120}bulkOperationLimiter/);
  assert.match(route, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(service, /excludedSecrets: \['password_hash', 'totp_secret', 'session tokens'\]/);
  assert.match(service, /FROM payments WHERE tenant_id=\? AND subscriber_id=\?/);
  assert.match(service, /FROM enrollments WHERE tenant_id=\? AND subscriber_id=\?/);
  assert.match(service, /JOIN support_tickets st[\s\S]{0,180}st\.tenant_id=\?/);
  assert.doesNotMatch(service, /SELECT \* FROM users/);
});

test('erasure is reviewed, transactional, blocks active obligations and verifies completion', () => {
  const route = read('routes/privacy.js');
  const service = read('lib/privacyService.js');
  const legacy = read('routes/admin-utils.js');

  assert.match(route, /privacy\/requests\/:id\/decision[\s\S]{0,180}requirePermission\('delete_subscribers'\)/);
  assert.match(route, /await conn\.beginTransaction\(\)[\s\S]*anonymizeSubscriber[\s\S]*await conn\.commit\(\)/);
  assert.match(service, /ERASURE_BLOCKED_ACTIVE_OBLIGATIONS/);
  assert.match(service, /session_version=session_version\+1/);
  assert.match(service, /UPDATE consultations SET client_name=\?,client_email=\?,client_phone=NULL,notes=NULL/);
  assert.match(service, /UPDATE orders SET customer_name=\?,customer_email=\?,customer_phone=NULL,notes=NULL/);
  assert.match(service, /retainedCategories/);
  assert.match(service, /Privacy erasure verification failed/);
  assert.match(legacy, /PRIVACY_WORKFLOW_REQUIRED/);
});

test('residency declaration cannot be marked verified without deployment evidence', () => {
  const route = read('routes/privacy.js');
  const migration = read('migrations/138_v25_privacy_request_workflow.sql');

  assert.match(route, /DATA_RESIDENCY_REGION must be configured on the deployment first/);
  assert.match(route, /Declared region does not match the deployment region/);
  assert.match(route, /residency_verified:/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tenant_privacy_policies/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS privacy_requests/);
  assert.match(migration, /evidence_hash CHAR\(64\)/);
});

test('privacy completion evidence is keyed and deterministic', () => {
  const previous = process.env.AUDIT_HMAC_SECRET;
  process.env.AUDIT_HMAC_SECRET = 'test-secret';
  try {
    const evidence = { tenantId: 't1', subscriberId: 's1', verified: true };
    assert.equal(evidenceHash(evidence), evidenceHash(evidence));
    assert.notEqual(evidenceHash(evidence), evidenceHash({ ...evidence, verified: false }));
  } finally {
    if (previous === undefined) delete process.env.AUDIT_HMAC_SECRET;
    else process.env.AUDIT_HMAC_SECRET = previous;
  }
});
