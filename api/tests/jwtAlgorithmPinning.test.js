'use strict';
// The algorithm a token is verified with must be named, not taken from the
// token's own header.
//
// jsonwebtoken refuses `alg: none` when a secret is supplied, and a probe
// against production confirms it, so nothing was open. It opens the day a key
// pair is introduced for anything: a token signed HS256 using that public key
// as its secret verifies as though it were RS256. Naming HS256 costs nothing
// and does not depend on a library default staying put.
//
// Every place that verifies a token is driven here with a token signed by the
// real secret under another algorithm, and must refuse it — the session
// middleware, the body-limit check, the tenant resolver, the 2FA pending
// token, the password-reset token. None of these reach the database before the
// signature is checked, so no database is needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-secret-0123456789abcdef0123';
const SECRET = process.env.JWT_SECRET;
const auth = require('../middleware/auth');
const { extractSignedTenant } = require('../middleware/tenantContext');
const { pendingTokenIdentity } = require('../lib/pendingTokenIdentity');
const { signAccessToken } = require('../lib/token');
const authRouter = require('../routes/auth');

const claims = { uid: 'u-1', email: 'a@example.test', tid: 'tenant-x', sv: 1, sid: 's-1', jti: 'j-1' };
const hs512 = payload => jwt.sign(payload, SECRET, { algorithm: 'HS512' });
const unsigned = payload => `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.`
  + `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;

function res() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
const reqWith = (token, extra = {}) => ({
  headers: { cookie: token ? `authToken=${encodeURIComponent(token)}` : '' }, body: {}, tenantId: 'tenant-x', ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' }, get: () => undefined, ...extra,
});
const handlerOf = (path) => authRouter.stack.find(l => l.route?.path === path && l.route.methods.post).route.stack.at(-1).handle;

test('the signer names HS256', () => {
  const token = signAccessToken({ uid: 'u-1', email: 'a@example.test', tenantId: 'tenant-x', sessionVersion: 1, sessionId: 's-1' });
  assert.equal(jwt.decode(token, { complete: true }).header.alg, 'HS256');
});

test('the session middleware refuses a token under another algorithm, or none', async () => {
  for (const token of [hs512(claims), unsigned(claims)]) {
    const out = res();
    let passed = false;
    await auth.requireAuth(reqWith(token), out, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(out.statusCode, 401);
    assert.equal(out.body.error, 'Invalid token');
  }
});

test('optional auth treats such a token as no token at all', async () => {
  const req = reqWith(hs512(claims));
  let passed = false;
  await auth.optionalAuth(req, res(), () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(req.user, undefined);
});

test('the larger body limit is only for a token signed HS256', () => {
  assert.equal(auth.hasSignedToken(reqWith(hs512(claims))), false);
  assert.equal(auth.hasSignedToken(reqWith(unsigned(claims))), false);
  assert.equal(auth.hasSignedToken(reqWith(jwt.sign(claims, SECRET, { algorithm: 'HS256' }))), true);
});

test('the tenant resolver takes no tenant from a token under another algorithm', () => {
  assert.equal(extractSignedTenant(reqWith(hs512(claims))), null);
  assert.equal(extractSignedTenant(reqWith(jwt.sign(claims, SECRET, { algorithm: 'HS256' }))), 'tenant-x');
});

test('an emailed-code pending token is honoured only when signed HS256', async () => {
  const pending = { ...claims, purpose: 'login_email_code' };
  assert.equal(pendingTokenIdentity(hs512(pending)), null);
  assert.equal(pendingTokenIdentity(jwt.sign(pending, SECRET, { algorithm: 'HS256' })), 'u-1');
  const out = res();
  await handlerOf('/api/auth/login/email-code/verify')(reqWith('', { body: { pendingToken: hs512(pending), code: '123456' } }), out);
  assert.equal(out.statusCode, 401);
  // Refused as an expired step — not let through to the code check behind it.
  assert.equal(out.body.code, 'EMAIL_CODE_PENDING_EXPIRED');
  assert.match(out.body.error, /انتهت مهلة/);
});

test('a password-reset token under another algorithm sets no password', async () => {
  // Its purpose is wrong too: read at all, it would be refused as «رمز غير صالح»;
  // refused at the signature, it never gets that far.
  const out = res();
  await handlerOf('/api/auth/reset-password')(
    reqWith('', { body: { resetToken: hs512({ ...claims, purpose: 'not-reset' }), newPassword: 'a-long-new-password' } }), out);
  assert.equal(out.statusCode, 400);
  assert.equal(out.body.error, 'انتهت صلاحية الرمز');
});

test('jsonwebtoken itself refuses a mismatched algorithm under the pin', () => {
  const wrong = jwt.sign({ uid: 'u1' }, SECRET, { algorithm: 'HS512' });
  assert.throws(() => jwt.verify(wrong, SECRET, { algorithms: ['HS256'] }), /invalid algorithm/i);
});
