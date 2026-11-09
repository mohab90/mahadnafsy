'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evidenceHash } = require('../lib/privacyService');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');







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
