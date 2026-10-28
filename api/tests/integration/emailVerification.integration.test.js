'use strict';
/**
 * An email given at sign-up is a claim until its owner proves it. Against a real
 * MariaDB: while unproven it finds no client record, signs nobody in, gets no
 * reset code and is not the caller's email on any route; the link or the code
 * proves it, and then it does all of those. The phone keeps working throughout.
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
const TENANT = 'tenant-sec2-email-it';
const IP = '41.33.10.22';
const EMAIL = 'client-sec2@example.test';
let pool; let router; let auth; let token; let identity; let verification; let bcrypt;

function makeRes() {
  const headers = {};
  return {
    statusCode: 200, body: null, headers, redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    redirect(code, url) { this.statusCode = code; this.redirectedTo = url; return this; },
    getHeader: name => headers[name.toLowerCase()],
    setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
    append(name, value) { headers[name.toLowerCase()] = [].concat(headers[name.toLowerCase()] || [], value); },
    cookie() { return this; },
  };
}
function makeReq(extra = {}) {
  return {
    body: {}, params: {}, query: {}, tenantId: TENANT, ip: IP, socket: { remoteAddress: IP },
    headers: { 'user-agent': 'node-test' }, get: () => undefined, ...extra,
  };
}
const handlerOf = (path, method) => router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle;

async function login(identifier) {
  const res = makeRes();
  await handlerOf('/api/auth/login', 'post')(makeReq({ body: { email: identifier, password: 'correct-horse-9' } }), res);
  return res;
}

async function clean() {
  for (const table of ['email_verifications', 'user_sessions', 'otp_codes', 'login_history', 'customer_devices', 'subscribers', 'users']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [TENANT]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/auth');
  auth = require('../../middleware/auth');
  token = require('../../lib/token');
  identity = require('../../lib/subscriberIdentity');
  verification = require('../../lib/emailVerification');
  bcrypt = require('../../lib/passwordHash');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Email IT', 'suspended')", [TENANT, TENANT]);
  // A paying client on file with this address and a different number…
  await pool.query(
    "INSERT INTO subscribers (id, tenant_id, name, email, phone) VALUES ('sub-sec2-real', ?, 'العميلة', ?, '1012000777')", [TENANT, EMAIL]);
  // …and a sign-up that typed the same address with its own number.
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, email_unverified, phone, password_hash, name, role, is_active)
     VALUES ('u-sec2-new', ?, ?, 1, '1012000888', ?, 'جديد', 'user', 1)`,
    [TENANT, EMAIL, await bcrypt.hash('correct-horse-9', 10)]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('unproven: the address finds no client record and is not the caller\'s email', { skip }, async () => {
  assert.equal(await identity.resolveSubscriberId({ tenantId: TENANT, user: { uid: 'u-sec2-new', email: EMAIL } }), null);
  const [[session]] = await pool.query("SELECT session_version FROM users WHERE id='u-sec2-new'");
  const sessionId = 'sess-sec2-email-1';
  await pool.query("UPDATE users SET active_session_id=? WHERE id='u-sec2-new'", [sessionId]);
  const bearer = token.signAccessToken({ uid: 'u-sec2-new', email: EMAIL, tenantId: TENANT, sessionVersion: session.session_version, sessionId });
  const req = makeReq({ headers: { authorization: `Bearer ${bearer}` } });
  let passed = false;
  await auth.requireAuth(req, makeRes(), () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(req.user.email, null, 'every route matching by req.user.email matches nothing');
  assert.equal(req.user.email_unverified, true);
});

test('unproven: no sign-in by the address, the phone still works', { skip }, async () => {
  const byEmail = await login(EMAIL);
  assert.equal(byEmail.statusCode, 401);
  const byPhone = await login('01012000888');
  assert.equal(byPhone.statusCode, 200, JSON.stringify(byPhone.body));
  assert.equal(byPhone.body.ok, true);
  const [[client]] = await pool.query("SELECT firebase_uid FROM subscribers WHERE id='sub-sec2-real'");
  assert.equal(client.firebase_uid, null, 'the phone sign-in did not take the client record by the claimed address');
});

test('unproven: a password reset by the address issues nothing', { skip }, async () => {
  await handlerOf('/api/auth/forgot-password', 'post')(makeReq({ body: { email: EMAIL } }), makeRes());
  await new Promise(resolve => setTimeout(resolve, 400));
  const [codes] = await pool.query("SELECT id FROM otp_codes WHERE tenant_id=? AND user_id='u-sec2-new'", [TENANT]);
  assert.equal(codes.length, 0);
});

test('a wrong code is refused; the link proves the address, and then it works everywhere', { skip }, async () => {
  const sent = [];
  const issued = await verification.issueEmailVerification(pool, {
    tenantId: TENANT, userId: 'u-sec2-new', email: EMAIL, send: async (...args) => { sent.push(args); },
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0][2], /\/api\/auth\/verify-email\?t=/);
  assert.equal((await verification.verifyEmailCode(pool, { tenantId: TENANT, userId: 'u-sec2-new', code: '000000' === issued.code ? '111111' : '000000' })).ok, false);

  const res = makeRes();
  await handlerOf('/api/auth/verify-email', 'get')(makeReq({ query: { t: issued.token } }), res);
  assert.equal(res.statusCode, 302);
  assert.match(res.redirectedTo, /emailVerified=1$/);
  const [[user]] = await pool.query("SELECT email_unverified, email_verified_at FROM users WHERE id='u-sec2-new'");
  assert.equal(Number(user.email_unverified), 0);
  assert.ok(user.email_verified_at);

  const again = makeRes();
  await handlerOf('/api/auth/verify-email', 'get')(makeReq({ query: { t: issued.token } }), again);
  assert.match(again.redirectedTo, /emailVerified=0$/, 'a link works once');

  assert.equal((await login(EMAIL)).statusCode, 200, 'sign-in by the proven address');
});

test('the code proves an address too', { skip }, async () => {
  await pool.query("UPDATE users SET email_unverified=1, email_verified_at=NULL WHERE id='u-sec2-new'");
  const issued = await verification.issueEmailVerification(pool, {
    tenantId: TENANT, userId: 'u-sec2-new', email: EMAIL, send: async () => {},
  });
  assert.equal((await verification.verifyEmailCode(pool, { tenantId: TENANT, userId: 'u-sec2-new', code: issued.code })).ok, true);
  const [[user]] = await pool.query("SELECT email_unverified FROM users WHERE id='u-sec2-new'");
  assert.equal(Number(user.email_unverified), 0);
});
