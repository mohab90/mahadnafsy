'use strict';
/**
 * Access tokens and the session they stand for, on a real MariaDB (these were regular expressions over lib/token.js and middleware/auth.js — `sv: Number(sessionVersion)`,
 * `sid: sessionId`, `stf: isStaff === true`, `Number(payload.sv) !== identity.sessionVersion`, `payload.stf !== true && payload.sid !== identity.sessionId`, the cookie flags):
 * a token names its institute, session version and session and says whether it is staff's; the next request is refused once the version has moved on (every credential change moves it)
 * or the account is switched off; a customer is on one device — another session replaces theirs — while staff may be on several; a token of another institute, or a revoked one, is
 * refused; staff sessions are shorter than customers' and the cookie cannot be read by the page. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-session-it'; const OTHER = 'tenant-session-other';
let pool; let auth; let tokens;

const sign = (overrides = {}) => tokens.signAccessToken({ uid: 'us-st-1', email: 'client-st@example.test', tenantId: T, sessionVersion: 1, sessionId: 'sid-a', ...overrides });
async function check(token, { tenantId = T } = {}) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  const req = { headers: { authorization: `Bearer ${token}` }, tenantId, query: {}, ip: '127.0.0.1', get: () => undefined };
  let passed = false;
  await auth.requireAuth(req, res, () => { passed = true; });
  return { passed, res, req };
}

async function clean() {
  for (const tenant of [T, OTHER]) await pool.query('DELETE FROM users WHERE tenant_id=?', [tenant]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  auth = require('../../middleware/auth');
  tokens = require('../../lib/token');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active'), (?, ?, 'IT2', 'active')", [T, T, OTHER, OTHER]);
  await pool.query("INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active, session_version, active_session_id) VALUES ('us-st-1', ?, 'client-st@example.test', NULL, 'x', 'عميلة', 'user', 1, 1, 'sid-a')", [T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a token names its institute, session version and session, and says whether it is staff\'s', { skip }, async () => {
  const customer = jwt.decode(sign());
  assert.deepEqual([customer.tid, customer.sv, customer.sid, customer.stf, customer.mfa], [T, 1, 'sid-a', false, false]);
  assert.ok(customer.jti, 'every token has an id, so it can be revoked');
  const staff = jwt.decode(sign({ isStaff: true, mfaVerified: true }));
  assert.deepEqual([staff.stf, staff.mfa], [true, true]);
  assert.throws(() => tokens.signAccessToken({ uid: 'u', tenantId: T, sessionVersion: 1 }), /identity is required/, 'no session, no token');
  assert.throws(() => tokens.signAccessToken({ uid: 'u', sessionId: 's', sessionVersion: 1 }), /identity is required/, 'no institute, no token');
  const lifetime = token => { const { exp, iat } = jwt.decode(token); return exp - iat; };
  assert.ok(lifetime(sign({ isStaff: true })) < lifetime(sign()), 'a staff session is a shift, a customer\'s is longer');
  const res = { headers: {}, getHeader() { return this.headers['Set-Cookie']; }, setHeader(name, value) { this.headers[name] = value; } };
  tokens.setAuthCookie(res, sign());
  const cookie = [].concat(res.headers['Set-Cookie']).find(item => item.startsWith('authToken='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=None/);
});

test('the same token is refused once the session version has moved on, once the session is replaced (a customer), or once the account is off', { skip }, async () => {
  const token = sign();
  const ok = await check(token);
  assert.equal(ok.passed, true);
  assert.equal(ok.req.user.tenant_id, T);

  await pool.query("UPDATE users SET active_session_id='sid-b' WHERE id='us-st-1'");
  const replaced = await check(token);
  assert.equal(replaced.passed, false, 'a customer is on one device: another sign-in replaced this session');
  assert.equal(replaced.res.body.code, 'SESSION_REVOKED');
  const staffToken = sign({ isStaff: true });
  assert.equal((await check(staffToken)).passed, true, 'staff may be on several devices');

  await pool.query("UPDATE users SET session_version=2 WHERE id='us-st-1'");
  const moved = await check(staffToken);
  assert.equal(moved.passed, false, 'a credential change ends every older session, staff\'s too');
  assert.equal(moved.res.body.code, 'SESSION_REVOKED');
  assert.equal((await check(sign({ sessionVersion: 2, sessionId: 'sid-b' }))).passed, true, 'the new session is fine');

  await pool.query("UPDATE users SET is_active=0 WHERE id='us-st-1'");
  const off = await check(sign({ sessionVersion: 2, sessionId: 'sid-b' }));
  assert.equal(off.res.body.code, 'ACCOUNT_UNAVAILABLE');
  await pool.query("UPDATE users SET is_active=1 WHERE id='us-st-1'");
});

test('a token of another institute, a revoked one and a forged one are refused', { skip }, async () => {
  const good = sign({ sessionVersion: 2, sessionId: 'sid-b' });
  assert.equal((await check(good)).passed, true);
  const elsewhere = await check(good, { tenantId: OTHER });
  assert.equal(elsewhere.passed, false, 'the token is bound to its institute');
  assert.equal(elsewhere.res.body.code, 'TENANT_MISMATCH');
  await tokens.revokeToken(jwt.decode(good).jti, Date.now() + 60_000);
  const revoked = await check(good);
  assert.equal(revoked.passed, false);
  assert.equal(revoked.res.statusCode, 401);
  const forged = jwt.sign({ uid: 'us-st-1', tid: T, sv: 2, sid: 'sid-b', stf: true, jti: 'forged-1' }, 'not-the-secret-not-the-secret-not-the-secret');
  const refused = await check(forged);
  assert.equal(refused.passed, false);
  assert.equal(refused.res.statusCode, 401);
});
