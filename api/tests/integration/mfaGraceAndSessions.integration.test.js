'use strict';
/**
 * Against a real MariaDB: a privileged account whose session did not come through
 * the code sent to its email is refused, one that did is let in; and an account
 * can list its sign-ins and sign the other devices out.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
// This file is about the policy itself: unlike the others it needs it on, as it is in production.
process.env.MAHAD_IT_NO_EMAIL_CODE = '0';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-sec2-mfa-it';
const IP = '41.33.10.21';
const asJson = value => (typeof value === 'string' ? JSON.parse(value) : value);
let pool; let auth; let router; let token; let singleSession;

function makeRes() {
  const headers = {};
  return {
    statusCode: 200, body: null, headers,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    getHeader: name => headers[name.toLowerCase()],
    setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
  };
}
function makeReq(bearer, extra = {}) {
  return {
    body: {}, params: {}, query: {}, tenantId: TENANT, ip: IP, socket: { remoteAddress: IP },
    headers: { authorization: `Bearer ${bearer}`, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0' },
    get: () => undefined, ...extra,
  };
}
// Runs the middleware chain the way Express would, stopping at the first that answers.
async function run(req, ...steps) {
  const res = makeRes();
  for (const step of steps) {
    let nextCalled = false;
    await step(req, res, () => { nextCalled = true; });
    if (!nextCalled) return { res, reached: false };
  }
  return { res, reached: true };
}
const handlerOf = (path, method) => router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle;

async function clean() {
  for (const table of ['user_sessions', 'audit_logs', 'audit_chain_heads', 'tenant_settings', 'staff', 'users']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [TENANT]).catch(() => {});
}

async function signIn(mfaVerified = false) {
  const session = await singleSession.rotateSingleSession(pool, {
    userId: 'u-sec2-acc', tenantId: TENANT, req: makeReq(''), allowConcurrent: true,
  });
  return token.signAccessToken({
    uid: 'u-sec2-acc', email: 'acc-sec2@example.test', tenantId: TENANT,
    sessionVersion: session.sessionVersion, sessionId: session.sessionId, isStaff: true, mfaVerified,
  });
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  auth = require('../../middleware/auth');
  token = require('../../lib/token');
  singleSession = require('../../lib/singleSession');
  router = require('../../routes/auth');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'MFA IT', 'suspended')", [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active)
     VALUES ('u-sec2-acc', ?, 'acc-sec2@example.test', 'x', 'محاسبة', 'user', 1)`, [TENANT]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at)
     VALUES ('st-sec2-acc', ?, 'محاسبة', 'acc-sec2@example.test', '1012000123', 'ACCOUNTANT', 1, '2025-01-01')`, [TENANT]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('a privileged account whose session did not come through the emailed code is refused; one that did is let in', { skip }, async () => {
  const unverified = await run(makeReq(await signIn(false)), auth.requireAuth, auth.requireAdminOrStaff);
  assert.equal(unverified.reached, false);
  assert.equal(unverified.res.statusCode, 403);
  assert.equal(unverified.res.body.code, 'MFA_REQUIRED');
  const verified = await run(makeReq(await signIn(true)), auth.requireAuth, auth.requireAdminOrStaff);
  assert.equal(verified.reached, true);
});

test('an account sees its sign-ins and can sign the other devices out', { skip }, async () => {
  const other = await signIn();
  const mine = await signIn();
  const req = makeReq(mine);
  await run(req, auth.requireAuth);
  const list = makeRes();
  await handlerOf('/api/auth/sessions', 'get')(req, list);
  assert.ok(list.body.sessions.length >= 2);
  assert.equal(list.body.sessions.filter(s => s.current).length, 1);
  assert.equal(list.body.sessions[0].device, 'Chrome · Windows');
  assert.match(list.body.sessions[0].ipHint, /^41\.33\.x\.x$/);

  const out = makeRes();
  await handlerOf('/api/auth/sessions/logout-others', 'post')(req, out);
  assert.equal(out.body.ok, true);
  assert.ok(out.body.signedOut >= 1);
  assert.match(String(out.headers['set-cookie']), /authToken=/, 'this device carries on with a new token');

  const stale = await run(makeReq(other), auth.requireAuth);
  assert.equal(stale.reached, false, 'the other device is signed out');
  assert.equal(stale.res.statusCode, 401);
  const after2 = makeRes();
  const fresh = String(out.headers['set-cookie']).match(/authToken=([^;]+)/)[1];
  const req2 = makeReq(fresh);
  assert.equal((await run(req2, auth.requireAuth)).reached, true, 'the re-issued token works');
  await handlerOf('/api/auth/sessions', 'get')(req2, after2);
  assert.equal(after2.body.sessions.length, 1);
  assert.equal(after2.body.sessions[0].current, true);
});
