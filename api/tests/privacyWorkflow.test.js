'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evidenceHash } = require('../lib/privacyService');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');



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
