'use strict';
// 4 Nov 2026: the emailed sign-in code is asked weekly, after a reset password, or after three wrong passwords — not at every sign-in.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-secret-0123456789abcdef';
const { isTrustedDevice, rememberTrustedDevice, TRUST_COOKIE, TRUST_DAYS } = require('../lib/trustedDevice');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const user = { id: 'u1', password_hash: 'hash-one' };
const dbWith = ({ wrong = 0, hash = 'hash-one' } = {}) => ({
  async query(sql) {
    if (/FROM login_history/.test(sql)) return [[{ n: wrong }]];
    if (/SELECT password_hash FROM users/.test(sql)) return [[{ password_hash: hash }]];
    throw new Error(`unexpected ${sql}`);
  },
});
const cookieOf = async (db = dbWith(), who = user, tenantId = 't1') => {
  const set = [];
  await rememberTrustedDevice({ append: (name, value) => set.push([name, value]) }, { db, tenantId, user: who });
  assert.equal(set[0][0], 'Set-Cookie');
  assert.match(set[0][1], new RegExp(`Max-Age=${TRUST_DAYS * 24 * 3600}; SameSite=None; Secure`));
  assert.match(set[0][1], /HttpOnly; Path=\/api\/auth/);
  return set[0][1].split(';')[0];
};
const asked = async (cookie, { db = dbWith(), who = user, tenantId = 't1' } = {}) =>
  isTrustedDevice({ headers: { cookie: `a=b; ${cookie}` } }, { db, tenantId, user: who });

test('a browser that proved the mailbox is trusted for the account, the tenant and the password it proved them under', async () => {
  const cookie = await cookieOf();
  assert.ok(cookie.startsWith(`${TRUST_COOKIE}=`));
  assert.equal(await asked(cookie), true);
  assert.equal(await asked(cookie, { who: { id: 'u2', password_hash: 'hash-one' } }), false, 'another account');
  assert.equal(await asked(cookie, { tenantId: 't2' }), false, 'another tenant');
  assert.equal(await isTrustedDevice({ headers: {} }, { db: dbWith(), tenantId: 't1', user }), false, 'no cookie, no trust');
  assert.equal(await asked(`${TRUST_COOKIE}=not.a.token`), false);
});

test('a reset password ends the trust', async () => {
  const cookie = await cookieOf();
  assert.equal(await asked(cookie, { who: { id: 'u1', password_hash: 'hash-two' } }), false);
  assert.equal(await asked(cookie, { who: { id: 'u1' }, db: dbWith({ hash: 'hash-two' }) }), false, 'read from the row when the lookup did not carry it');
  assert.equal(await asked(cookie, { who: { id: 'u1' }, db: dbWith({ hash: 'hash-one' }) }), true);
});

test('three wrong passwords in the hour end the trust, two do not', async () => {
  const cookie = await cookieOf();
  assert.equal(await asked(cookie, { db: dbWith({ wrong: 2 }) }), true);
  assert.equal(await asked(cookie, { db: dbWith({ wrong: 3 }) }), false);
});

test('the weekly expiry is the cookie\'s own: a token past seven days is not trusted', async () => {
  const jwt = require('jsonwebtoken');
  const expired = jwt.sign({ purpose: 'trusted_device', uid: 'u1', tid: 't1', pw: 'x', iat: Math.floor(Date.now() / 1000) - 8 * 86400, exp: Math.floor(Date.now() / 1000) - 86400 }, process.env.JWT_SECRET);
  assert.equal(await asked(`${TRUST_COOKIE}=${expired}`), false);
  assert.equal(TRUST_DAYS, 7);
});

test('the sign-in routes ask for the code unless the device is trusted, and only the code step leaves the cookie', () => {
  const password = read('routes/auth/session.js');
  assert.match(password, /const trustedDevice = needsCode && await isTrustedDevice\(req/);
  assert.match(password, /if \(needsCode && !trustedDevice\)/);
  assert.match(password, /mfaVerified: trustedDevice === true/);
  const whatsapp = read('routes/auth/whatsappLogin.js');
  assert.match(whatsapp, /if \(needsCode && !trustedDevice\)/);
  assert.match(whatsapp, /mfaVerified: trustedDevice === true/);
  const code = read('routes/auth/refreshAndEmailCode.js');
  assert.match(code, /await rememberTrustedDevice\(res, \{ db: pool, tenantId, user \}\);\s*setAuthCookie\(res, token\);/);
  assert.equal((code.match(/rememberTrustedDevice\(/g) || []).length, 1);
});
