'use strict';
/**
 * Against a real MariaDB: the mandatory-2FA grace period is started and kept in
 * users.mfa_grace_started_at, a privileged account is let in during it and
 * refused after it while the enrolment routes still answer; and an account can
 * list its sign-ins and sign the other devices out.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
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

async function signIn() {
  const session = await singleSession.rotateSingleSession(pool, {
    userId: 'u-sec2-acc', tenantId: TENANT, req: makeReq(''), allowConcurrent: true,
  });
  return token.signAccessToken({
    uid: 'u-sec2-acc', email: 'acc-sec2@example.test', tenantId: TENANT,
    sessionVersion: session.sessionVersion, sessionId: session.sessionId, isStaff: true,
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

test('first sign-in of a privileged account without 2FA starts its grace period and lets it in, told', { skip }, async () => {
  const bearer = await signIn();
  const { res, reached } = await run(makeReq(bearer), auth.requireAuth, auth.requireAdminOrStaff);
  assert.equal(reached, true);
  assert.ok(res.headers['x-mfa-enrolment-due'], 'told until when');
  const [[row]] = await pool.query("SELECT mfa_grace_started_at FROM users WHERE id='u-sec2-acc'");
  assert.ok(row.mfa_grace_started_at, 'the start is kept');
  const [[policy]] = await pool.query("SELECT config_json FROM tenant_settings WHERE tenant_id=? AND section='security_mfa_policy'", [TENANT]);
  assert.ok(asJson(policy.config_json).enforced_from, 'the rollout is written down once');

  const status = makeRes();
  const req = makeReq(bearer);
  await run(req, auth.requireAuth);
  await handlerOf('/api/auth/2fa/requirement', 'get')(req, status);
  assert.equal(status.body.required, true);
  assert.equal(status.body.blocked, false);
  assert.ok(Date.parse(status.body.graceEndsAt) > Date.now());
});

test('after the grace period only the enrolment routes answer', { skip }, async () => {
  await pool.query("UPDATE users SET mfa_grace_started_at = NOW() - INTERVAL 10 DAY WHERE id='u-sec2-acc'");
  // The policy was enforced from just now in the first test; push the rollout back too.
  const [[policyRow]] = await pool.query("SELECT config_json FROM tenant_settings WHERE tenant_id=? AND section='security_mfa_policy'", [TENANT]);
  const policy = asJson(policyRow.config_json);
  policy.enforced_from = new Date(Date.now() - 20 * 86400000).toISOString();
  await pool.query("UPDATE tenant_settings SET config_json=? WHERE tenant_id=? AND section='security_mfa_policy'", [JSON.stringify(policy), TENANT]);
  await require('../../lib/mfaPolicy').getMfaPolicy(TENANT, { fresh: true });

  const bearer = await signIn();
  const refused = await run(makeReq(bearer), auth.requireAuth, auth.requireAdminOrStaff);
  assert.equal(refused.reached, false);
  assert.equal(refused.res.statusCode, 403);
  assert.equal(refused.res.body.code, 'MFA_ENROLLMENT_REQUIRED');

  const req = makeReq(bearer);
  assert.equal((await run(req, auth.requireAuth)).reached, true, 'a session is still a session');
  const setup = makeRes();
  await handlerOf('/api/auth/2fa/setup', 'post')(req, setup);
  assert.equal(setup.statusCode, 200);
  assert.ok(setup.body.qrDataUrl, 'the enrolment answers');
  const status = makeRes();
  await handlerOf('/api/auth/2fa/requirement', 'get')(req, status);
  assert.equal(status.body.blocked, true);
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
