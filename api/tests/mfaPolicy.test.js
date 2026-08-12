'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const authRoute = read('routes', 'auth.js');
const authMiddleware = read('middleware', 'auth.js');
const adminConfig = read('routes', 'misc', 'admincfg.js');
const securityUi = read('..', 'admin', 'pages', 'dashboard', 'tabs', 'SecurityDashboardTab.tsx');
const ipUi = read('..', 'admin', 'pages', 'dashboard', 'tabs', 'IpWhitelistTab.tsx');

test('MFA factors are owned by auth users and successful TOTP produces an MFA-authenticated JWT', () => {
  // The login lookup also resolves whether the account is staff, so the issued
  // token can carry the concurrent-device flag without the auth middleware ever
  // querying `staff` itself (authTenantIsolation pins that separately).
  assert.match(authRoute, /SELECT u\.id, u\.email, u\.name, u\.password_hash, u\.session_version, u\.totp_enabled/);
  assert.match(authRoute, /AS is_staff/);
  // The claim is no longer the staff row alone: an owner configured through
  // ADMIN_EMAILS/ADMIN_UIDS may have no staff row, and reading it from that
  // table only put them under the one-device rule — evicting themselves each
  // time the admin panel and the public site were open together.
  assert.match(authRoute, /const isOperator = Boolean\(user\.is_staff\)/);
  assert.match(authRoute, /ADMIN_EMAILS\.some[\s\S]{0,120}ADMIN_UIDS\.includes\(user\.id\)/);
  assert.match(authRoute, /isStaff: isOperator/);
  // Every route that re-issues a token must carry the claim forward, or the
  // rule reappears on the first refresh.
  assert.match(authRoute, /isStaff: req\.user\.is_staff === true/);
  assert.doesNotMatch(
    authRoute,
    /sessionId: session\.sessionId, mfaVerified: (true|false),\n\s*\}\);/,
    'a token is being signed without an isStaff claim'
  );
  assert.match(authRoute, /UPDATE users SET totp_enabled=1 WHERE id=\? AND tenant_id=\?/);
  assert.match(authRoute, /rotateSingleSession\(pool/);
  assert.match(authRoute, /mfaVerified: true/);
  assert.match(authMiddleware, /mfa_verified: payload\.mfa === true/);
  assert.match(authRoute, /const \{ valid \} = await verify/);
  assert.doesNotMatch(authRoute, /\bauthenticator\./);
});

test('installed otplib runtime generates and verifies the same RFC 6238 factor used by auth routes', async () => {
  const { generate, generateSecret, generateURI, verify } = require('otplib');
  const secret = generateSecret();
  const token = await generate({ secret });
  const result = await verify({ secret, token });
  assert.equal(result.valid, true);
  const previousToken = await generate({
    secret,
    epoch: Math.floor(Date.now() / 1000) - 30,
  });
  assert.equal((await verify({ secret, token: previousToken, epochTolerance: 30 })).valid, true);
  assert.match(generateURI({ issuer: 'Mahad', label: 'uat@mahad.test', secret }), /^otpauth:\/\/totp\//);
});

test('tenant policy enforces MFA on upper administration and configured sensitive permissions', () => {
  assert.match(authMiddleware, /getMfaPolicy\(req\.tenantId\)/);
  assert.match(authMiddleware, /policyRequiresStaff\(policy, staff, requestedPermissions\)/);
  assert.match(authMiddleware, /MFA_ENROLLMENT_REQUIRED/);
  assert.match(adminConfig, /\/api\/admin\/security\/mfa-policy/);
  assert.match(adminConfig, /requirePermission\('manage_security'\)/);
});

test('MFA cannot be disabled while tenant policy requires it', () => {
  assert.match(authRoute, /policy\.enabled && \(forcedAdmin \|\| policyRequiresStaff\(policy, staff\)\)/);
  assert.match(authRoute, /code: 'MFA_POLICY_ENFORCED'/);
});

test('security UI persists MFA policy and IP rules through server APIs, never local storage', () => {
  assert.match(securityUi, /\/api\/admin\/security\/mfa-policy/);
  assert.match(securityUi, /<IpWhitelistTab notify=\{notify\}/);
  assert.doesNotMatch(securityUi, /localStorage|mahad_ip_whitelist/);
  assert.match(ipUi, /\/api\/admin\/ip-whitelist/);
  assert.doesNotMatch(ipUi, /api\.ipify\.org/);
});

test('IP matching supports exact IPv4 and CIDR boundaries', () => {
  const { matches } = require('../middleware/ipWhitelist')._test;
  assert.equal(matches('10.2.3.4', '10.2.3.4'), true);
  assert.equal(matches('10.2.3.4', '10.2.3.0/24'), true);
  assert.equal(matches('10.2.4.4', '10.2.3.0/24'), false);
  assert.equal(matches('999.2.3.4', '10.0.0.0/8'), false);
});
