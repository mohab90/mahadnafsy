'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('user, staff, OTP and login security identities are unique and indexed per tenant', () => {
  const migration = read('migrations/087_v25_auth_tenant_identity.sql');
  assert.match(migration, /uq_users_tenant_email \(tenant_id, email/);
  assert.match(migration, /idx_otp_tenant_email_type \(tenant_id, email/);
  assert.match(migration, /idx_login_history_tenant_status \(tenant_id, status/);
  assert.match(migration, /uq_staff_tenant_email \(tenant_id, email/);
  assert.match(migration, /DROP INDEX IF EXISTS uq_users_email/);
});

test('login, password reset and 2FA never resolve an identity outside request tenant', () => {
  const auth = read('routes/auth.js');
  const audit = read('lib/loginAudit.js');
  assert.match(auth, /FROM users WHERE tenant_id=\? AND email = \? AND is_active = 1/);
  assert.match(auth, /FROM subscribers WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\)/);
  assert.match(auth, /FROM otp_codes WHERE tenant_id=\?/);
  assert.match(auth, /UPDATE users SET password_hash=\? WHERE id=\? AND tenant_id=\?/);
  assert.match(auth, /tid: req\.tenantId/);
  assert.match(auth, /logLoginAttempt\(\{ userId: user\.id/);
  assert.match(audit, /INSERT INTO login_history[\s\S]*tenant_id/);
});

test('all account creation paths persist tenant ownership', () => {
  for (const relative of ['routes/auth.js', 'routes/admin/leads.js', 'routes/admin/subscribers.js', 'routes/misc/admincfg.js']) {
    const source = read(relative);
    assert.doesNotMatch(source, /INSERT INTO users \(id, email/);
  }
});
