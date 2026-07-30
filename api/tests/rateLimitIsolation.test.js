'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'test-only-rate-limit-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const { keyBy, normalizedAction, publicRequestMax } = require('../middleware/rateLimits');

const request = (overrides = {}) => ({
  method: 'POST',
  baseUrl: '/api/admin',
  path: '/subscribers/123',
  ip: '203.0.113.10',
  tenantId: 'tenant-a',
  user: { uid: 'user-a' },
  body: {},
  ...overrides,
});

test('privileged limiter isolates tenant, user, IP and normalized action', () => {
  const key = keyBy('user');
  const base = key(request());
  assert.notEqual(base, key(request({ tenantId: 'tenant-b' })));
  assert.notEqual(base, key(request({ user: { uid: 'user-b' } })));
  assert.notEqual(base, key(request({ ip: '203.0.113.11' })));
  assert.notEqual(base, key(request({ path: '/payments/123' })));
});

test('resource ids cannot create fresh action buckets', () => {
  assert.equal(
    normalizedAction(request({ path: '/subscribers/123' })),
    normalizedAction(request({ path: '/subscribers/999' })),
  );
  assert.equal(
    normalizedAction(request({ path: '/requests/550e8400-e29b-41d4-a716-446655440000/decision' })),
    normalizedAction(request({ path: '/requests/2c5ea4c0-4067-4dc9-9c45-83b92c412aa1/decision' })),
  );
});

test('TOTP challenges are rate-limited per pending account instead of one shared anonymous bucket', () => {
  const key = keyBy('user');
  const tokenA = jwt.sign(
    { uid: 'user-a', purpose: 'totp_pending' },
    process.env.JWT_SECRET,
  );
  const tokenB = jwt.sign(
    { uid: 'user-b', purpose: 'totp_pending' },
    process.env.JWT_SECRET,
  );
  const anonymous = { user: null, body: {}, path: '/api/auth/2fa/verify' };
  const pendingA = { ...anonymous, body: { pendingToken: tokenA } };
  const pendingB = { ...anonymous, body: { pendingToken: tokenB } };
  assert.notEqual(key(request(pendingA)), key(request(pendingB)));
});

test('public reads tolerate shared office NAT while mutations remain conservative', () => {
  assert.equal(publicRequestMax({ method: 'GET' }), 600);
  assert.equal(publicRequestMax({ method: 'HEAD' }), 600);
  assert.equal(publicRequestMax({ method: 'POST' }), 60);
});

test('production readiness requires the distributed Redis store', () => {
  const root = path.join(__dirname, '..');
  const store = fs.readFileSync(path.join(root, 'lib', 'rateLimitStore.js'), 'utf8');
  const readiness = fs.readFileSync(path.join(root, 'tools', 'production-readiness.cjs'), 'utf8');
  const health = fs.readFileSync(path.join(root, 'routes', 'core', 'intake.js'), 'utf8');
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

  assert.match(store, /RATE_LIMIT_REDIS_ENABLED/);
  assert.match(store, /new RedisStore/);
  assert.match(store, /passOnStoreError|REDIS_URL/);
  assert.match(readiness, /distributed-rate-limit/);
  assert.match(health, /redisHealth/);
  assert.match(health, /status\(ready \? 200 : 503\)/);
  assert.match(env, /RATE_LIMIT_REDIS_ENABLED=true/);
});

test('successful staff logins do not exhaust a shared branch IP limit', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'rateLimits.js'), 'utf8');
  const loginWindow = source.slice(source.indexOf('const loginLimiter'), source.indexOf('const otpLimiter'));
  assert.equal((loginWindow.match(/skipSuccessfulRequests: true/g) || []).length, 2);
  assert.match(loginWindow, /login-ip/);
  assert.match(loginWindow, /login-account/);
});
