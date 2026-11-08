'use strict';
const { authRouteSource } = require('./_authRouteSource');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const authRoute = authRouteSource();
const authMiddleware = read('middleware', 'auth.js');
const adminConfig = read('routes', 'misc', 'admincfg.js');
const securityUi = read('..', 'admin', 'pages', 'dashboard', 'tabs', 'SecurityDashboardTab.tsx');
const ipUi = read('..', 'admin', 'pages', 'dashboard', 'tabs', 'IpWhitelistTab.tsx');







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
