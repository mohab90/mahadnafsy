'use strict';
/**
 * Two-factor sign-in against a real MariaDB (audit finding, 11 Oct 2026): an
 * account enrolled before secrets were sealed still signs in and is sealed on
 * the way; a new enrolment gets ten recovery codes, one of which signs in once;
 * a fresh set retires the old; and the owner's reset clears it all, ends the
 * sessions and leaves an audit row. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
// The owner, for the guard that keeps a manager off the owner's own factor.
process.env.ADMIN_EMAILS = [process.env.ADMIN_EMAILS, 'owner-2fa-it@example.test'].filter(Boolean).join(',');
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-2fa-it';
const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';
const LEGACY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const IP = '41.33.10.20';

let pool; let router; let jwt; let otplib; let hashClientIp; let twoFactor;

const handlerOf = (path, method = 'post') => {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  return layer.route.stack.at(-1).handle;
};
function makeRes() {
  const headers = {};
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    getHeader: name => headers[name.toLowerCase()],
    setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
    headers,
  };
}
function makeReq({ body = {}, params = {}, user = null, tenantId = TENANT } = {}) {
  return {
    body, params, query: {}, tenantId, user, ip: IP, socket: { remoteAddress: IP },
    headers: { 'user-agent': 'node-test' }, get: () => undefined,
  };
}
async function call(path, req) {
  const res = makeRes();
  await handlerOf(path)(req, res);
  return res;
}
async function pendingFor(userId, email) {
  const [[row]] = await pool.query('SELECT session_version FROM users WHERE id=?', [userId]);
  return jwt.sign(
    { uid: userId, email, tid: TENANT, sv: row.session_version, purpose: 'totp_pending', iph: hashClientIp(IP) },
    process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' }
  );
}
const totpFor = secret => otplib.generate({ secret });

// The test tenant's own audit chain goes too, whole, so each run starts a fresh one.
async function clean() {
  await pool.query('DELETE FROM audit_logs WHERE tenant_id=?', [TENANT]).catch(() => {});
  await pool.query('DELETE FROM audit_chain_heads WHERE tenant_id=?', [TENANT]).catch(() => {});
  await pool.query('DELETE FROM user_mfa_recovery_codes WHERE tenant_id=?', [TENANT]).catch(() => {});
  await pool.query('DELETE FROM users WHERE tenant_id=?', [TENANT]).catch(() => {});
  await pool.query('DELETE FROM staff WHERE tenant_id=?', [TENANT]).catch(() => {});
  await pool.query("DELETE FROM users WHERE tenant_id=? AND id IN ('u-2fa-owner','u-2fa-boss')", [DEFAULT_TENANT]).catch(() => {});
  await pool.query("DELETE FROM staff WHERE tenant_id=? AND id IN ('st-2fa-owner','st-2fa-boss')", [DEFAULT_TENANT]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  jwt = require('jsonwebtoken');
  otplib = require('otplib');
  ({ hashClientIp } = require('../../lib/clientContext'));
  twoFactor = require('../../lib/twoFactor');
  router = require('../../routes/auth');
  await clean();
  const users = [
    ['u-2fa-legacy', 'legacy@example.test', LEGACY, 1],
    ['u-2fa-new', 'new@example.test', null, 0],
    ['u-2fa-target', 'target@example.test', twoFactor.sealTotpSecret(LEGACY), 1],
    ['u-2fa-admin', 'admin@example.test', null, 0],
  ];
  for (const [id, email, secret, enabled] of users) {
    await pool.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active, session_version, totp_secret, totp_enabled)
       VALUES (?, ?, ?, 'x', ?, 'staff', 1, 3, ?, ?)`, [id, TENANT, email, email, secret, enabled]);
    await pool.query(
      `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, totp_secret, totp_enabled)
       VALUES (?, ?, ?, ?, '1012340000', 'SALES', 1, '2025-01-01', ?, ?)`,
      [id.replace('u-', 'st-'), TENANT, email, email, secret, enabled]);
  }
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('an account enrolled before sealing still signs in, and is sealed in both tables on the way', { skip }, async () => {
  const pendingToken = await pendingFor('u-2fa-legacy', 'legacy@example.test');
  const res = await call('/api/auth/2fa/verify', makeReq({ body: { pendingToken, token: await totpFor(LEGACY) } }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok([].concat(res.headers['set-cookie']).some(cookie => /^authToken=/.test(cookie)));
  const [[user]] = await pool.query("SELECT totp_secret FROM users WHERE id='u-2fa-legacy'");
  const [[staff]] = await pool.query("SELECT totp_secret FROM staff WHERE id='st-2fa-legacy'");
  for (const stored of [user.totp_secret, staff.totp_secret]) {
    assert.ok(twoFactor.isSealedSecret(stored), 'sealed');
    assert.ok(!stored.includes(LEGACY));
  }
  // …and the sealed form signs in just the same next time.
  const again = await call('/api/auth/2fa/verify', makeReq({
    body: { pendingToken: await pendingFor('u-2fa-legacy', 'legacy@example.test'), token: await totpFor(LEGACY) },
  }));
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
});

let codes = [];
test('switching 2FA on seals the secret and shows ten recovery codes, stored only as hashes', { skip }, async () => {
  const user = { uid: 'u-2fa-new', email: 'new@example.test', is_staff: true };
  const setup = await call('/api/auth/2fa/setup', makeReq({ user }));
  assert.equal(setup.statusCode, 200, JSON.stringify(setup.body));
  const { secret } = setup.body;
  const [[row]] = await pool.query("SELECT totp_secret FROM users WHERE id='u-2fa-new'");
  assert.ok(twoFactor.isSealedSecret(row.totp_secret) && !row.totp_secret.includes(secret));

  const enabled = await call('/api/auth/2fa/enable', makeReq({ user, body: { token: await totpFor(secret) } }));
  assert.equal(enabled.statusCode, 200, JSON.stringify(enabled.body));
  codes = enabled.body.recoveryCodes;
  assert.equal(codes.length, 10);
  const [stored] = await pool.query("SELECT code_hash FROM user_mfa_recovery_codes WHERE tenant_id=? AND user_id='u-2fa-new'", [TENANT]);
  assert.equal(stored.length, 10);
  const all = JSON.stringify(stored);
  for (const code of codes) assert.ok(!all.includes(code) && !all.includes(code.replace(/-/g, '')));

  const status = makeRes();
  await handlerOf('/api/auth/2fa/status', 'get')(makeReq({ user }), status);
  assert.deepEqual(status.body, { enabled: true, recoveryCodesLeft: 10 });
});

test('a recovery code signs in instead of the authenticator, once', { skip }, async () => {
  const code = codes[0].toLowerCase();
  const first = await call('/api/auth/2fa/verify', makeReq({
    body: { pendingToken: await pendingFor('u-2fa-new', 'new@example.test'), recoveryCode: code },
  }));
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.body.recoveryCodesLeft, 9);
  const second = await call('/api/auth/2fa/verify', makeReq({
    body: { pendingToken: await pendingFor('u-2fa-new', 'new@example.test'), recoveryCode: code },
  }));
  assert.equal(second.statusCode, 401);
  assert.equal(second.body.code, 'RECOVERY_CODE_INVALID', 'burned');
  const [[audit]] = await pool.query(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE tenant_id=? AND action='auth.mfa.recovery_code_used' AND entity_id='u-2fa-new'", [TENANT]);
  assert.equal(Number(audit.n), 1);
});

test('a fresh set needs the authenticator and retires the old one', { skip }, async () => {
  const user = { uid: 'u-2fa-new', email: 'new@example.test', is_staff: true };
  const refused = await call('/api/auth/2fa/recovery-codes', makeReq({ user, body: { token: '000000' } }));
  assert.equal(refused.statusCode, 400);
  const [[row]] = await pool.query("SELECT totp_secret FROM users WHERE id='u-2fa-new'");
  const { secret } = twoFactor.readTotpSecret(row.totp_secret);
  const fresh = await call('/api/auth/2fa/recovery-codes', makeReq({ user, body: { token: await totpFor(secret) } }));
  assert.equal(fresh.statusCode, 200, JSON.stringify(fresh.body));
  assert.equal(fresh.body.recoveryCodes.length, 10);
  const old = await call('/api/auth/2fa/verify', makeReq({
    body: { pendingToken: await pendingFor('u-2fa-new', 'new@example.test'), recoveryCode: codes[1] },
  }));
  assert.equal(old.statusCode, 401, 'an unused code from the old set no longer works');
});

test('the owner reset clears the secret and codes, ends the sessions, and is audited', { skip }, async () => {
  await twoFactor.replaceRecoveryCodes(pool, { tenantId: TENANT, userId: 'u-2fa-target' });
  const [[before]] = await pool.query("SELECT session_version FROM users WHERE id='u-2fa-target'");
  const res = await call('/api/admin/staff/:id/reset-2fa', makeReq({
    params: { id: 'st-2fa-target' }, user: { uid: 'u-2fa-admin', email: 'admin@example.test' },
  }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [[user]] = await pool.query("SELECT totp_secret, totp_enabled, session_version, active_session_id FROM users WHERE id='u-2fa-target'");
  assert.equal(user.totp_secret, null);
  assert.equal(Number(user.totp_enabled), 0);
  assert.equal(Number(user.session_version), Number(before.session_version) + 1);
  const [[staff]] = await pool.query("SELECT totp_secret, totp_enabled FROM staff WHERE id='st-2fa-target'");
  assert.deepEqual([staff.totp_secret, Number(staff.totp_enabled)], [null, 0]);
  const [[left]] = await pool.query("SELECT COUNT(*) AS n FROM user_mfa_recovery_codes WHERE tenant_id=? AND user_id='u-2fa-target'", [TENANT]);
  assert.equal(Number(left.n), 0);
  const [[audit]] = await pool.query(
    "SELECT severity, actor_id FROM audit_logs WHERE tenant_id=? AND action='auth.mfa.reset_by_owner' AND entity_id='st-2fa-target'", [TENANT]);
  assert.equal(audit.severity, 'warning');
  assert.equal(audit.actor_id, 'u-2fa-admin');
});

test('not your own from this button, and not the owner\'s by anyone but the owner', { skip }, async () => {
  const own = await call('/api/admin/staff/:id/reset-2fa', makeReq({
    params: { id: 'st-2fa-admin' }, user: { uid: 'u-2fa-admin', email: 'admin@example.test' },
  }));
  assert.equal(own.statusCode, 409);
  assert.equal(own.body.code, 'OWN_ACCOUNT');

  await pool.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active, totp_secret, totp_enabled)
     VALUES ('u-2fa-owner', ?, 'owner-2fa-it@example.test', 'x', 'owner', 'admin', 1, ?, 1)`, [DEFAULT_TENANT, twoFactor.sealTotpSecret(LEGACY)]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at)
     VALUES ('st-2fa-owner', ?, 'owner', 'owner-2fa-it@example.test', '1012340001', 'ADMIN', 1, '2025-01-01')`, [DEFAULT_TENANT]);
  const byManager = await call('/api/admin/staff/:id/reset-2fa', makeReq({
    tenantId: DEFAULT_TENANT, params: { id: 'st-2fa-owner' }, user: { uid: 'u-2fa-boss', email: 'boss-2fa-it@example.test' },
  }));
  assert.equal(byManager.statusCode, 403);
  assert.equal(byManager.body.code, 'OWNER_ONLY');
  const [[owner]] = await pool.query("SELECT totp_enabled FROM users WHERE id='u-2fa-owner'");
  assert.equal(Number(owner.totp_enabled), 1, 'untouched');
});
