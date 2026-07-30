'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveSecret } = require('../lib/secretResolver');
const { auditSecretPolicy } = require('../lib/productionConfig');

test('managed secret files are read without placing secret contents in environment variables', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahad-secret-'));
  const file = path.join(dir, 'audit');
  const value = 'a'.repeat(64);
  fs.writeFileSync(file, `${value}\n`, { mode: 0o600 });
  try {
    const env = { AUDIT_HMAC_SECRET_FILE: file, JWT_SECRET: 'b'.repeat(64) };
    assert.equal(resolveSecret('AUDIT_HMAC_SECRET', env), value);
    assert.equal(auditSecretPolicy(env).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('secret resolution rejects ambiguous, relative, empty and oversized files', () => {
  assert.throws(
    () => resolveSecret('AUDIT_HMAC_SECRET', {
      AUDIT_HMAC_SECRET: 'direct',
      AUDIT_HMAC_SECRET_FILE: 'also-file',
    }),
    /cannot both/
  );
  assert.throws(
    () => resolveSecret('AUDIT_HMAC_SECRET', { AUDIT_HMAC_SECRET_FILE: 'relative/secret' }),
    /absolute path/
  );
});
