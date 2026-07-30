'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('password-reset OTPs are HMAC protected at rest and verified from delivered mail', () => {
  const auth = read('routes/auth.js');
  const schema = read('schema.sql');
  const migration = read('migrations/159_v25_otp_secret_storage.sql');
  const smoke = read('tools/forgot-password-smoke.cjs');

  assert.match(auth, /createHmac\('sha256'/);
  assert.match(auth, /hashOtp\(\{\s*tenantId:\s*req\.tenantId,\s*email:\s*safeEmail/);
  assert.match(schema, /`code` char\(64\) NOT NULL/);
  assert.match(migration, /MODIFY COLUMN code CHAR\(64\) NOT NULL/);
  assert.match(migration, /SET used=1/);
  assert.doesNotMatch(smoke, /code:\s*otp\.code/);
  assert.match(smoke, /FAKE_SMTP_CAPTURE_FILE/);
});

test('production refuses a missing or reused OTP HMAC secret', () => {
  const { criticalProductionPolicy } = require('../lib/productionConfig');
  const base = {
    NODE_ENV: 'production',
    JWT_SECRET: 'j'.repeat(48),
    SESSION_BINDING_SECRET: 's'.repeat(48),
    OTP_HMAC_SECRET: 'o'.repeat(48),
    AUDIT_HMAC_SECRET: 'a'.repeat(48),
    AUTH_SECRET_SOURCE: 'secret-manager',
    AUTH_SECRET_PROVIDER: 'provider-secret-service',
    JWT_SECRET_REFERENCE: 'projects/prod/secrets/jwt/versions/7',
    SESSION_BINDING_SECRET_REFERENCE: 'projects/prod/secrets/session-binding/versions/7',
    OTP_HMAC_SECRET_REFERENCE: 'projects/prod/secrets/otp-hmac/versions/7',
    AUTH_SECRET_ROTATED_AT: '2026-07-01',
    AUDIT_SECRET_SOURCE: 'secret-manager',
    AUDIT_SECRET_PROVIDER: 'provider-secret-service',
    AUDIT_SECRET_REFERENCE: 'projects/prod/secrets/audit/versions/7',
    AUDIT_SECRET_ROTATED_AT: '2026-07-01',
  };
  assert.equal(criticalProductionPolicy(base).ok, true);
  assert.equal(criticalProductionPolicy({ ...base, OTP_HMAC_SECRET: '' }).ok, false);
  assert.equal(criticalProductionPolicy({ ...base, OTP_HMAC_SECRET: base.JWT_SECRET }).ok, false);
});

test('browser MFA retries safely across a TOTP boundary and avoids parallel session invalidation', () => {
  const helper = fs.readFileSync(path.join(__dirname, '..', '..', 'e2e', 'helpers', 'adminLogin.ts'), 'utf8');
  const config = fs.readFileSync(path.join(__dirname, '..', '..', 'e2e', 'playwright.config.ts'), 'utf8');
  assert.match(helper, /mfaAttempts < 2/);
  assert.match(helper, /30_000 - \(Date\.now\(\) % 30_000\) \+ 500/);
  assert.match(helper, /غير صحيح\|منتهي الصلاحية\|invalid\|expired/);
  assert.match(config, /workers:\s*1/);
});
