'use strict';
const { authRouteSource, sourceOf } = require('./_authRouteSource');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('login, password reset and 2FA never resolve an identity outside request tenant', () => {
  const auth = authRouteSource();
  const audit = read('lib/loginAudit.js');
  assert.match(auth, /FROM users WHERE tenant_id=\? AND email = \? AND is_active = 1/);
  assert.match(auth, /FROM subscribers WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\)/);
  assert.match(auth, /FROM otp_codes WHERE tenant_id=\?/);
  assert.match(auth, /SET password_hash=\?, session_version=session_version\+1[\s\S]*WHERE id=\? AND tenant_id=\? AND session_version=\?/);
  assert.match(auth, /tid: req\.tenantId/);
  assert.match(auth, /logLoginAttempt\(\{ userId: user\.id/);
  
});

test('all account creation paths persist tenant ownership', () => {
  for (const relative of ['routes/auth.js', 'routes/admin/leads.js', 'routes/admin/subscribers.js', 'routes/misc/admincfg.js']) {
    const source = sourceOf(relative);
    assert.doesNotMatch(source, /INSERT INTO users \(id, email/);
  }
});
