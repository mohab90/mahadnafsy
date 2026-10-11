'use strict';

// Audit finding (11 Oct 2026): the TOTP secret sat in users and staff as plain
// text, there were no recovery codes, and nothing but HR offboarding ever
// cleared a lost factor. The secret is sealed now (read both ways), ten
// one-time codes stand in for a lost phone, and the owner can reset it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { authRouteSource } = require('./_authRouteSource');

process.env.CHANNEL_SECRET_KEY = process.env.CHANNEL_SECRET_KEY || 'test-key-at-least-sixteen-chars-long';
const secretBox = require('../lib/secretBox');
const {
  RECOVERY_CODE_COUNT, consumeRecoveryCode, generateRecoveryCodes, hashRecoveryCode, isSealedSecret,
  normalizeRecoveryCode, readTotpSecret, replaceRecoveryCodes, sealLegacySecret, sealTotpSecret,
} = require('../lib/twoFactor');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const LEGACY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

test('a sealed secret reads back, never shows the secret, and fits the widened column', () => {
  const sealed = sealTotpSecret(LEGACY);
  assert.ok(isSealedSecret(sealed));
  assert.ok(!sealed.includes(LEGACY));
  assert.ok(sealed.length <= 255, `${sealed.length} characters`);
  assert.ok(sealed.length > 64, 'which is why migration 272 widens the column');
  assert.deepEqual(readTotpSecret(sealed), { secret: LEGACY, legacy: false, unreadable: false });
});

test('a secret stored before sealing still reads, marked to be sealed', () => {
  assert.deepEqual(readTotpSecret(LEGACY), { secret: LEGACY, legacy: true, unreadable: false });
  assert.deepEqual(readTotpSecret(null), { secret: null, legacy: false, unreadable: false });
});

test('sealed under another key it is unreadable, not mistaken for a plain secret', () => {
  const sealed = sealTotpSecret(LEGACY);
  const previous = process.env.CHANNEL_SECRET_KEY;
  process.env.CHANNEL_SECRET_KEY = 'a-different-key-after-rotation-0000';
  secretBox._resetKeyCache();
  try {
    assert.deepEqual(readTotpSecret(sealed), { secret: null, legacy: false, unreadable: true });
  } finally {
    process.env.CHANNEL_SECRET_KEY = previous;
    secretBox._resetKeyCache();
  }
});

test('sealing a legacy secret touches only rows still holding that plain value, in both tables', async () => {
  const calls = [];
  await sealLegacySecret({ query: async (sql, params) => { calls.push([sql, params]); return [{ affectedRows: 1 }]; } },
    { tenantId: 't', userId: 'u-1', email: ' Rep@X.test ', secret: LEGACY });
  assert.equal(calls.length, 2);
  assert.match(calls[0][0], /UPDATE users SET totp_secret=\? WHERE id=\? AND tenant_id=\? AND totp_secret=\?/);
  assert.match(calls[1][0], /UPDATE staff SET totp_secret=\? WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\)=\? AND totp_secret=\?/);
  assert.equal(calls[1][1][2], 'rep@x.test');
  for (const [, params] of calls) {
    assert.ok(isSealedSecret(params[0]));
    assert.equal(params.at(-1), LEGACY);
  }
});

test('ten distinct codes, easy to read off paper', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, RECOVERY_CODE_COUNT);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
});

test('a code is hashed per account, and typed any way it still matches', () => {
  const [code] = generateRecoveryCodes(1);
  const hash = hashRecoveryCode({ tenantId: 't', userId: 'u-1', code });
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hashRecoveryCode({ tenantId: 't', userId: 'u-1', code: code.toLowerCase().replace(/-/g, ' ') }), hash);
  assert.notEqual(hashRecoveryCode({ tenantId: 't', userId: 'u-2', code }), hash, 'another account, another hash');
  assert.ok(!hash.includes(code.replace(/-/g, '')));
  assert.equal(normalizeRecoveryCode('123456'), '', 'a TOTP is not a recovery code');
  assert.equal(hashRecoveryCode({ tenantId: 't', userId: 'u-1', code: 'O0O0-I1I1-O0O0' }), '', 'not our alphabet');
});

test('a new set replaces the old, and only hashes are written', async () => {
  const calls = [];
  const codes = await replaceRecoveryCodes({ query: async (sql, params) => { calls.push([sql, params]); return [{}]; } }, { tenantId: 't', userId: 'u-1' });
  assert.match(calls[0][0], /DELETE FROM user_mfa_recovery_codes WHERE tenant_id=\? AND user_id=\?/);
  const rows = calls[1][1][0];
  assert.equal(rows.length, 10);
  const written = JSON.stringify(rows);
  for (const code of codes) assert.ok(!written.includes(code) && !written.includes(code.replace(/-/g, '')), 'no plain code stored');
});

test('a code is burned by one UPDATE that matches an unused one only', async () => {
  let affected = 1;
  const calls = [];
  const db = { query: async (sql, params) => { calls.push([sql, params]); return [{ affectedRows: affected }]; } };
  const [code] = generateRecoveryCodes(1);
  assert.equal(await consumeRecoveryCode(db, { tenantId: 't', userId: 'u-1', code }), true);
  assert.match(calls[0][0], /SET used_at=NOW\(\)[\s\S]*AND used_at IS NULL/);
  affected = 0;
  assert.equal(await consumeRecoveryCode(db, { tenantId: 't', userId: 'u-1', code }), false, 'already used');
  calls.length = 0;
  assert.equal(await consumeRecoveryCode(db, { tenantId: 't', userId: 'u-1', code: 'nonsense' }), false);
  assert.equal(calls.length, 0, 'not a code: no query at all');
});

test('the routes seal on setup, accept a recovery code at sign-in, and keep the old secrets working', () => {
  const auth = authRouteSource();
  assert.match(auth, /const sealed = sealTotpSecret\(secret\);/);
  assert.doesNotMatch(auth, /'UPDATE users SET totp_secret=\?, totp_enabled=0 WHERE id=\? AND tenant_id=\?',\s*\[secret,/,
    'the plain secret is never written');
  assert.match(auth, /const \{ pendingToken, token: totpToken, recoveryCode \} = req\.body/);
  assert.match(auth, /consumeRecoveryCode\(pool, \{ tenantId, userId: payload\.uid, code: recoveryCode \}\)/);
  assert.match(auth, /if \(check\.legacy\) \{\s*await sealLegacySecret/);
  assert.match(auth, /router\.post\('\/api\/auth\/2fa\/recovery-codes', requireAuth, loginLimiter/);
  assert.match(auth, /res\.json\(\{ ok: true, message: 'تم تفعيل المصادقة الثنائية بنجاح', recoveryCodes \}\)/);
});

test('the owner reset is super-admin only, audited, and ends the sessions', () => {
  const auth = authRouteSource();
  assert.match(auth, /router\.post\('\/api\/admin\/staff\/:id\/reset-2fa', requireAuth, requireSuperAdmin,/);
  const route = auth.slice(auth.indexOf("'/api/admin/staff/:id/reset-2fa'"));
  assert.match(route, /session_version=session_version\+1/);
  assert.match(route, /clearRecoveryCodes\(conn/);
  assert.match(route, /writeAuditEvent\(\{\s*req, db: conn, action: 'auth\.mfa\.reset_by_owner'/);
});

test('offboarding takes the recovery codes with the factor', () => {
  assert.match(read('routes', 'hr', 'offboarding.js'), /clearRecoveryCodes\(conn, \{ tenantId: req\.tenantId, userIds: users\.map/);
});

test('the login screen offers a recovery code, and the staff screen the reset behind a confirmation', () => {
  const login = read('..', 'admin', 'pages', 'Auth.tsx');
  assert.match(login, /استخدم كود استرجاع/);
  assert.match(login, /mysqlAuth\.verify2faRecovery\(twoFaTempToken, twoFaCode\)/);
  const api = read('..', 'admin', 'lib', 'mysqlapi.ts');
  assert.match(api, /JSON\.stringify\(\{ pendingToken, recoveryCode \}\)/);
  assert.match(api, /\/reset-2fa`/);
  const staff = read('..', 'admin', 'pages', 'staff-profile', 'StaffSettingsPanel.tsx');
  assert.match(staff, /setConfirmReset2fa\(true\)/);
  assert.match(staff, /confirmReset2fa \? \(/);
  assert.match(staff, /mysqlAuth\.resetStaff2fa\(staff\.id\)/);
  const settings = read('..', 'admin', 'pages', 'dashboard', 'tabs', 'SystemSettingsTab.tsx');
  assert.match(settings, /أكواد الاسترجاع — هتظهر المرة دي بس/);
  assert.match(settings, /mysqlAuth\.regenerateRecoveryCodes\(token\)/);
});
