'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const auth = read('routes/auth.js');
const middleware = read('middleware/auth.js');
const token = read('lib/token.js');
const migration = read('migrations/134_v25_session_revocation.sql');
const bindingMigration = read('migrations/149_v25_customer_auth_geo_integrity.sql');

test('access tokens carry a tenant-bound session version and middleware rejects stale sessions', () => {
  assert.match(token, /sv: Number\(sessionVersion\)/);
  assert.match(token, /sid: sessionId/);
  // Written as an early-return guard rather than one boolean expression, so the
  // staff concurrency exemption below can only ever relax the sid check — never
  // this one.
  assert.match(middleware, /Number\(payload\.sv\) !== identity\.sessionVersion\) return false/);
  // The one-device rule still compares sid to the stored session id, but only
  // for customers: it protects paid video from a shared password, and applying
  // it to staff meant a second device silently evicted the first. Staff get
  // concurrent devices via the signed `stf` claim; assert both halves so neither
  // the comparison nor the gate can be dropped by accident.
  assert.match(middleware, /payload\.stf !== true && payload\.sid !== identity\.sessionId/);
  assert.match(token, /stf: isStaff === true/);
  // …and that concurrency never weakens revocation: session_version is still
  // checked for everybody, with no staff exemption.
  assert.match(middleware, /Number\(payload\.sv\) !== identity\.sessionVersion\) return false/);
  assert.match(middleware, /hashClientIp\(requestIp\) === identity\.sessionIpHash/);
  assert.match(middleware, /code: 'SESSION_REVOKED'/);
  assert.match(migration, /session_version INT UNSIGNED NOT NULL DEFAULT 1/);
  assert.match(bindingMigration, /active_session_ip_hash CHAR\(64\)/);
});

test('every credential mutation invalidates all older user sessions', () => {
  const increments = auth.match(/session_version\s*=\s*session_version\s*\+\s*1/g) || [];
  assert.ok(increments.length >= 5, `expected at least five credential revocation points, found ${increments.length}`);
  assert.match(auth, /WHERE id=\? AND tenant_id=\? AND session_version=\?/);
  assert.match(auth, /invalidateIdentity\(payload\.tid, payload\.uid\)/);
  assert.match(auth, /clearAuthCookie\(res\)/);
});

test('refresh revokes the old jti durably before issuing the replacement token', () => {
  const refresh = auth.slice(auth.indexOf("router.post('/api/auth/refresh'"), auth.indexOf('// TOTP 2FA'));
  assert.match(refresh, /await revokeToken\(oldJti, tokenExpiryMs\(req\.user\)\)/);
  assert.ok(refresh.indexOf('await revokeToken') < refresh.indexOf('signAccessToken'));
});

test('dead legacy OTP 2FA endpoint is removed and the active TOTP endpoint remains', () => {
  assert.doesNotMatch(auth, /router\.post\('\/api\/auth\/verify-2fa'/);
  assert.match(auth, /router\.post\('\/api\/auth\/2fa\/verify'/);
});

test('central token issuer creates verifiable session-versioned JWTs', () => {
  const script = `
    process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';
    const jwt = require('jsonwebtoken');
    const { signAccessToken } = require('./lib/token');
    const encoded = signAccessToken({ uid:'u1', email:'u@example.com', tenantId:'tenant-a', sessionVersion:7, sessionId:'session-1' });
    const payload = jwt.verify(encoded, process.env.JWT_SECRET);
    process.stdout.write(JSON.stringify({ uid: payload.uid, tid: payload.tid, sv: payload.sv, sid: payload.sid, jti: !!payload.jti }));
    process.exit(0);
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { uid: 'u1', tid: 'tenant-a', sv: 7, sid: 'session-1', jti: true });
});
