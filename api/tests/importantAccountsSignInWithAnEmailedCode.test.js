'use strict';
/**
 * 29 Oct 2026: «محتاج الغي فكرة تطبيق المصادقه دا تماما واخلي الدخول علي السسيتم بكود بيروح للايميل فقط». The accounts the security
 * policy names sign in with the password and then a six-digit code sent to their email (lib/loginEmailCode.js); the authenticator app,
 * its enrolment screen, its grace period and its recovery codes are gone.
 * Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-mfa-secret-0123456789-abcdefghijklmnopqrstuvw';
process.env.ADMIN_EMAILS = 'owner@x.test';

let storedPolicy = { version: 2, enabled: true, required_roles: ['admin', 'manager', 'accountant', 'hr'], required_permissions: ['manage_financial'] };
let staffRow = null;
const sent = [];
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { async query(sql) { if (/FROM staff/.test(sql)) return [[staffRow]]; return [{ affectedRows: 1 }]; } },
});
stub('../lib/tenantSettings', {
  getTenantSetting: async () => storedPolicy,
  setTenantSetting: async (_key, value) => { storedPolicy = value; },
});
stub('../lib/email', { sendEmail: async (to, subject, html) => { sent.push({ to, subject, html }); return { ok: true }; } });

const mfa = require('../lib/mfaPolicy');
const loginCode = require('../lib/loginEmailCode');
const { requireAdmin, requireAdminOrStaff } = require('../middleware/auth');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

function fakeRes() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
async function through(guard, user) {
  const res = fakeRes();
  let passed = false;
  await guard({ user: { tenant_id: 'tenant-default', ...user }, tenantId: 'tenant-default' }, res, () => { passed = true; });
  return { passed, res };
}
const owner = extra => ({ uid: 'u-owner', email: 'owner@x.test', ...extra });

// A database that remembers just enough of login_email_codes to run the real code against.
function fakeCodeTable() {
  const rows = [];
  return {
    rows,
    async query(sql, params = []) {
      if (/SELECT TIMESTAMPDIFF/.test(sql)) {
        const live = rows.filter(row => !row.used && row.userId === params[1]).pop();
        return [[live ? { age: live.age } : undefined]];
      }
      if (/^UPDATE login_email_codes SET used_at=NOW\(\) WHERE tenant_id=\? AND user_id=\? AND used_at IS NULL/.test(sql)) {
        rows.filter(row => row.userId === params[1]).forEach(row => { row.used = true; });
        return [{ affectedRows: 1 }];
      }
      if (/^INSERT INTO login_email_codes/.test(sql)) {
        rows.push({ id: params[0], userId: params[2], hash: params[4], attempts: 0, used: false, age: 0 });
        return [{ affectedRows: 1 }];
      }
      if (/^UPDATE login_email_codes SET used_at=NOW\(\) WHERE id=\?$/.test(sql)) {
        rows.find(row => row.id === params[0]).used = true;
        return [{ affectedRows: 1 }];
      }
      if (/^SELECT id, code_hash FROM login_email_codes/.test(sql)) {
        const live = rows.filter(row => !row.used && row.userId === params[1] && row.attempts < params[2]).pop();
        return [[live ? { id: live.id, code_hash: live.hash } : undefined]];
      }
      if (/SET attempts=attempts\+1/.test(sql)) {
        const row = rows.find(r => r.id === params[1]);
        row.attempts += 1;
        if (row.attempts >= params[0]) row.used = true;
        return [{ affectedRows: 1 }];
      }
      if (/^UPDATE login_email_codes SET used_at=NOW\(\) WHERE id=\? AND used_at IS NULL/.test(sql)) {
        const row = rows.find(r => r.id === params[0]);
        if (row.used) return [{ affectedRows: 0 }];
        row.used = true;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}
const lastCode = () => String(sent[sent.length - 1].html.match(/otp-box">(\d{6})</)[1]);

test('a session of an account the policy names that did not come through the code is turned away; one that did, is in', async () => {
  const refused = await through(requireAdmin, owner({ mfa_verified: false }));
  assert.equal(refused.passed, false);
  assert.equal(refused.res.statusCode, 403);
  assert.equal(refused.res.body.code, 'MFA_REQUIRED');
  assert.equal((await through(requireAdmin, owner({ mfa_verified: true }))).passed, true);
});

test('there is no grace period and no enrolment: nothing lets an unverified important account through', async () => {
  staffRow = { id: 'st-1', role: 'ACCOUNTANT', permissions_json: null, tenant_id: 'tenant-default' };
  const accountant = await through(requireAdminOrStaff, { uid: 'u-acc', email: 'acc@x.test', mfa_verified: false });
  assert.equal(accountant.passed, false);
  assert.equal(accountant.res.body.code, 'MFA_REQUIRED');
  staffRow = { id: 'st-2', role: 'SALES', permissions_json: null, tenant_id: 'tenant-default' };
  assert.equal((await through(requireAdminOrStaff, { uid: 'u-sales', email: 'sales@x.test', mfa_verified: false })).passed, true, 'sales holds no money permission');
  staffRow = null;
});

test('by default nobody is asked for the code, and an old stored policy does not turn it on', async () => {
  // 31 Oct 2026: «دخول بالايميل والباصورد فقط لحين نظبط الفريق». Nothing stored, the authenticator-era policy (no version, even one that
  // said enabled), and a version-2 policy the owner never saved all leave everybody on the email and the password.
  assert.equal(mfa.DEFAULT_MFA_POLICY.enabled, false);
  assert.equal(mfa.normalizeMfaPolicy(null).enabled, false);
  assert.equal(mfa.normalizeMfaPolicy({ enabled: true, required_roles: ['admin'] }).enabled, false, 'a policy from before version 2 never meant this code');
  assert.equal(mfa.normalizeMfaPolicy({ version: 2 }).enabled, false);
  assert.equal(mfa.normalizeMfaPolicy({ version: 2, enabled: true }).enabled, true, 'only the owner saving it from the security screen turns it on');
  const before = storedPolicy;
  storedPolicy = null;
  await mfa.getMfaPolicy('tenant-default', { fresh: true });
  assert.equal(await loginCode.accountNeedsEmailCode({ tenantId: 'tenant-default', user: { id: 'u-owner', email: 'owner@x.test' } }), false, 'not even the owner');
  storedPolicy = { enabled: true, required_roles: ['admin'] };
  await mfa.getMfaPolicy('tenant-default', { fresh: true });
  assert.equal(await loginCode.accountNeedsEmailCode({ tenantId: 'tenant-default', user: { id: 'u-owner', email: 'owner@x.test' } }), false);
  storedPolicy = before;
  await mfa.getMfaPolicy('tenant-default', { fresh: true });
});

test('with the policy off nobody is asked', async () => {
  storedPolicy = { ...storedPolicy, enabled: false };
  await mfa.getMfaPolicy('tenant-default', { fresh: true });
  assert.equal(await loginCode.accountNeedsEmailCode({ tenantId: 'tenant-default', user: { id: 'u-owner', email: 'owner@x.test' } }), false);
  storedPolicy = { ...storedPolicy, enabled: true };
  await mfa.getMfaPolicy('tenant-default', { fresh: true });
});

test('who owes the code: the owner and the listed roles or permissions — not a customer, not a sales rep', async () => {
  assert.equal(await loginCode.accountNeedsEmailCode({ tenantId: 'tenant-default', user: { id: 'u-owner', email: 'owner@x.test' } }), true);
  staffRow = { role: 'hr', permissions_json: null };
  assert.equal(await loginCode.accountNeedsEmailCode({ tenantId: 'tenant-default', user: { id: 'u-hr', email: 'hr@x.test' } }), true);
  staffRow = { role: 'sales', permissions_json: JSON.stringify(['manage_financial']) };
  assert.equal(await loginCode.accountNeedsEmailCode({ tenantId: 'tenant-default', user: { id: 'u-s', email: 's@x.test' } }), true, 'a permission granted by hand counts');
  staffRow = { role: 'sales', permissions_json: null };
  assert.equal(await loginCode.accountNeedsEmailCode({ tenantId: 'tenant-default', user: { id: 'u-s2', email: 's2@x.test' } }), false);
  staffRow = null;
  assert.equal(await loginCode.accountNeedsEmailCode({ tenantId: 'tenant-default', user: { id: 'u-c', email: 'client@x.test' } }), false, 'a customer is not staff');
});

test('the policy has no grace days or enrolment date left, and the roles that see money are listed for the day the owner turns it on', () => {
  const fresh = mfa.normalizeMfaPolicy({});
  assert.equal(fresh.enabled, false, 'off until the owner turns it on (31 Oct 2026)');
  assert.equal('grace_days' in fresh, false);
  assert.equal('enforced_from' in fresh, false);
  for (const role of ['admin', 'manager', 'accountant', 'collection', 'online_manager', 'daqqi_manager', 'tagamoa_manager', 'sales_collection_manager', 'hr']) {
    assert.ok(fresh.required_roles.includes(role), role);
  }
  assert.ok(!fresh.required_roles.includes('sales'));
  const ownersChoice = mfa.normalizeMfaPolicy({ version: 2, enabled: false, required_roles: ['admin'] });
  assert.equal(ownersChoice.enabled, false, 'once the owner has chosen on version 2, the choice stands');
});

test('the code is mailed to the account, stored only as a hash, and opens the sign-in once', async () => {
  const db = fakeCodeTable();
  sent.length = 0;
  await loginCode.sendLoginCode(db, { tenantId: 't', userId: 'u1', email: 'Owner@X.test', name: 'Owner' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@x.test');
  const code = lastCode();
  assert.equal(db.rows.length, 1);
  assert.ok(!JSON.stringify(db.rows).includes(code), 'only the hash is kept');
  assert.deepEqual(await loginCode.checkLoginCode(db, { tenantId: 't', userId: 'u1', code }), { ok: true });
  assert.deepEqual(await loginCode.checkLoginCode(db, { tenantId: 't', userId: 'u1', code }), { ok: false, reason: 'expired' }, 'a code works once');
});

test('five wrong tries burn the code, even for the right one afterwards', async () => {
  const db = fakeCodeTable();
  sent.length = 0;
  await loginCode.sendLoginCode(db, { tenantId: 't', userId: 'u2', email: 'a@x.test' });
  const code = lastCode();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.deepEqual(await loginCode.checkLoginCode(db, { tenantId: 't', userId: 'u2', code: wrong }), { ok: false, reason: 'wrong_code' });
  }
  assert.deepEqual(await loginCode.checkLoginCode(db, { tenantId: 't', userId: 'u2', code }), { ok: false, reason: 'expired' });
});

test('a new code replaces the old one, and cannot be asked for in a flood', async () => {
  const db = fakeCodeTable();
  sent.length = 0;
  await loginCode.sendLoginCode(db, { tenantId: 't', userId: 'u3', email: 'a@x.test' });
  const first = lastCode();
  await assert.rejects(loginCode.sendLoginCode(db, { tenantId: 't', userId: 'u3', email: 'a@x.test' }), error => error.statusCode === 429 && error.code === 'EMAIL_CODE_TOO_SOON');
  db.rows.forEach(row => { row.age = 120; });
  await loginCode.sendLoginCode(db, { tenantId: 't', userId: 'u3', email: 'a@x.test' });
  const second = lastCode();
  if (first !== second) {
    assert.deepEqual(await loginCode.checkLoginCode(db, { tenantId: 't', userId: 'u3', code: first }), { ok: false, reason: 'wrong_code' });
  }
  assert.deepEqual(await loginCode.checkLoginCode(db, { tenantId: 't', userId: 'u3', code: second }), { ok: true });
});

test('the password entered again inside the resend window keeps the code already sent, instead of refusing a person who holds a good code', async () => {
  // Found by signing in through the real admin screen twice within 45 s: the second answer was a 429 the screen showed as «تعذر إتمام العملية».
  const db = fakeCodeTable();
  stub('../lib/db', { pool: db });
  stub('../lib/loginAudit', { logLoginAttempt: async () => {} });
  const user = { id: 'u9', email: 'a@x.test', name: 'A', session_version: 1 };
  sent.length = 0;
  const first = await loginCode.startEmailCodeStep({}, { user, tenantId: 't' });
  const second = await loginCode.startEmailCodeStep({}, { user, tenantId: 't' });
  assert.equal(first.emailCodeRequired, true);
  assert.equal(second.emailCodeRequired, true);
  assert.ok(second.pendingToken, 'a fresh step to come back with');
  assert.equal(sent.length, 1, 'no second email: the first code is still the live one');
  assert.deepEqual(await loginCode.checkLoginCode(db, { tenantId: 't', userId: 'u9', code: lastCode() }), { ok: true });
  // Any other refusal still reaches the screen.
  stub('../lib/email', { sendEmail: async () => { throw new Error('smtp down'); } });
  await assert.rejects(loginCode.startEmailCodeStep({}, { user: { ...user, id: 'u10' }, tenantId: 't' }), error => error.code === 'EMAIL_CODE_SEND_FAILED');
  stub('../lib/email', { sendEmail: async (to, subject, html) => { sent.push({ to, subject, html }); return { ok: true }; } });
  stub('../lib/db', { pool: { async query(sql) { if (/FROM staff/.test(sql)) return [[staffRow]]; return [{ affectedRows: 1 }]; } } });
});

test('an account with no email, or whose mail cannot be sent, is told so and left with no live code', async () => {
  const db = fakeCodeTable();
  await assert.rejects(loginCode.sendLoginCode(db, { tenantId: 't', userId: 'u4', email: '' }), error => error.code === 'EMAIL_CODE_NO_EMAIL');
  stub('../lib/email', { sendEmail: async () => { throw new Error('smtp down'); } });
  await assert.rejects(loginCode.sendLoginCode(db, { tenantId: 't', userId: 'u4', email: 'a@x.test' }), error => error.statusCode === 503 && error.code === 'EMAIL_CODE_SEND_FAILED');
  assert.ok(db.rows.every(row => row.used), 'nobody waits for a message that was never sent');
  stub('../lib/email', { sendEmail: async (to, subject, html) => { sent.push({ to, subject, html }); return { ok: true }; } });
});

test('the pending step is a signed token for this purpose only', () => {
  const token = loginCode.signPendingToken({ user: { id: 'u1', email: 'a@x.test', session_version: 3 }, tenantId: 't', via: 'password' });
  const payload = loginCode.readPendingToken(token);
  assert.deepEqual([payload.uid, payload.sv, payload.via, payload.purpose], ['u1', 3, 'password', 'login_email_code']);
  assert.throws(() => loginCode.readPendingToken('nope'), error => error.statusCode === 401);
  const jwt = require('jsonwebtoken');
  const other = jwt.sign({ uid: 'u1', purpose: 'totp_pending' }, process.env.JWT_SECRET);
  assert.throws(() => loginCode.readPendingToken(other), error => error.statusCode === 400, 'a token for anything else is not this step');
  assert.equal(loginCode.maskEmail('mohab@gmail.com'), 'mo***@gmail.com');
});

test('both doors — password and WhatsApp — owe the code, and the app, its routes and its screens are gone', () => {
  const session = read('routes', 'auth', 'session.js');
  const whatsapp = read('routes', 'auth', 'whatsappLogin.js');
  assert.match(session, /accountNeedsEmailCode/);
  assert.match(session, /startEmailCodeStep\(req/);
  assert.match(whatsapp, /accountNeedsEmailCode/);
  assert.match(whatsapp, /via: 'whatsapp'/);
  // The code is asked before any session is made, on both.
  assert.ok(session.indexOf('accountNeedsEmailCode({') < session.indexOf('rotateSingleSession(pool'));
  assert.ok(whatsapp.indexOf('accountNeedsEmailCode({') < whatsapp.indexOf('rotateSingleSession(pool'));
  const codeRoutes = read('routes', 'auth', 'refreshAndEmailCode.js');
  assert.match(codeRoutes, /router\.post\('\/api\/auth\/login\/email-code\/verify', otpLimiter/);
  assert.match(codeRoutes, /router\.post\('\/api\/auth\/login\/email-code\/resend', otpLimiter/);
  assert.match(codeRoutes, /mfaVerified: true/);
  for (const gone of ['routes/auth/refreshAndTwoFactor.js', 'lib/twoFactor.js', 'lib/totpSecretSweep.js', 'tools/reset-2fa.cjs']) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', gone)), false, `${gone} is retired`);
  }
  const everything = [session, whatsapp, codeRoutes, read('middleware', 'auth.js'), read('routes', 'auth', 'adminCredentials.js')].join('\n');
  assert.doesNotMatch(everything, /otplib|totp_pending|2fa\/(setup|enable|verify|disable)|recovery-codes|reset-2fa/);
  assert.match(read('migrations', '347_v26_login_email_codes.sql'), /UPDATE users SET totp_enabled = 0, totp_secret = NULL/);
});
