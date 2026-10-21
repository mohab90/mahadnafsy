'use strict';
/**
 * Behaviour of the 20 Oct review's security and robustness findings that run
 * without a database: input readers, the docs gate, the body limit, the login
 * buckets, staff session length, outgoing webhooks, the Paymob order binding,
 * the dummy password check and the per-institute client code.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-security-hardening-secret-0123456789abcdef';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const jwt = require('jsonwebtoken');

// Requiring the app opens pools and timers nothing here needs.
after(() => setTimeout(() => process.exit(), 300).unref());

test('field readers refuse objects, text for numbers, negatives and out-of-range values', () => {
  const { numberValue, textValue, FieldError } = require('../lib/inputFields');
  assert.equal(numberValue('150', { field: 'p', min: 0 }), 150);
  assert.equal(numberValue(undefined, { field: 'p', fallback: 0 }), 0);
  assert.equal(numberValue('', { field: 'p', fallback: 0 }), 0);
  for (const bad of ['abc', -500, { x: 1 }, [1], Infinity]) {
    assert.throws(() => numberValue(bad, { field: 'p', label: 'السعر', min: 0 }), FieldError, String(bad));
  }
  assert.throws(() => numberValue(999, { field: 'rating', min: 0, max: 5 }), /5 أو أقل/);
  assert.throws(() => numberValue(2.5, { field: 's', integer: true }), FieldError);
  assert.equal(textValue(' عنوان ', { field: 't' }), 'عنوان');
  assert.throws(() => textValue({ x: 1 }, { field: 't' }), FieldError);
  assert.throws(() => textValue('', { field: 't', required: true }), /مطلوب/);
  assert.throws(() => textValue('x'.repeat(11), { field: 't', max: 10 }), FieldError);
});

test('a public form refuses an object where a name or phone belongs', () => {
  const { scalarFields } = require('../lib/inputFields');
  const guard = scalarFields('name', 'phone');
  const run = body => {
    let status = 200; let passed = false;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    guard({ body }, res, () => { passed = true; });
    return { status, passed };
  };
  assert.deepEqual(run({ name: 'a', phone: '010', extra: { ok: 1 } }), { status: 200, passed: true });
  assert.deepEqual(run({ name: ['a'] }), { status: 400, passed: false });
  assert.deepEqual(run({ phone: { x: 1 } }), { status: 400, passed: false });
  assert.deepEqual(run([1, 2]), { status: 400, passed: false });
  const { validate } = require('../lib/helpers');
  assert.match(validate({ email: { a: 1 } }, { email: 'optional|160' }), /must be text/);
});

test('API docs are staff-only in production and open in development', async () => {
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => { req.tenantId = 'tenant-docs-unit'; next(); });
  app.use(require('../routes/docs'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal((await fetch(`${base}/api/openapi.json`)).status, 401);
    assert.equal((await fetch(`${base}/api/docs`)).status, 401);
    process.env.NODE_ENV = 'development';
    assert.equal((await fetch(`${base}/api/docs`)).status, 200);
  } finally {
    process.env.NODE_ENV = previous;
    await new Promise(resolve => server.close(resolve));
  }
});

test('the 10 MB body limit needs a token this server signed; anything larger is a 413, not a 500', async () => {
  const { hasSignedToken } = require('../middleware/auth');
  const signed = jwt.sign({ uid: 'u-1', jti: 'j-1' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  assert.equal(hasSignedToken({ headers: { cookie: `authToken=${signed}` } }), true);
  assert.equal(hasSignedToken({ headers: { authorization: `Bearer ${signed}` } }), true);
  assert.equal(hasSignedToken({ headers: { cookie: 'authToken=anything' } }), false);
  assert.equal(hasSignedToken({ headers: {} }), false);

  const { createHttpApp } = require('../lib/httpApp');
  const app = createHttpApp({ pool: { query: async () => [[]] }, brandAssetRoot: os.tmpdir() });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const big = JSON.stringify({ message: 'x'.repeat(2 * 1024 * 1024) });
  try {
    for (const headers of [{}, { cookie: 'authToken=anything' }]) {
      const response = await fetch(`${base}/api/contact`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: big });
      assert.equal(response.status, 413, JSON.stringify(headers));
      assert.equal((await response.json()).code, 'PAYLOAD_TOO_LARGE');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('login buckets: one account across every network, and a known browser is not counted with strangers', () => {
  const { keyBy } = require('../middleware/rateLimits');
  const base = { method: 'POST', baseUrl: '', path: '/api/auth/login', tenantId: 't', body: { email: 'owner@x.test' } };
  const account = keyBy('account');
  assert.equal(account({ ...base, ip: '203.0.113.1' }), account({ ...base, ip: '198.51.100.7' }));
  assert.notEqual(keyBy('user')({ ...base, ip: '203.0.113.1' }), keyBy('user')({ ...base, ip: '198.51.100.7' }));

  const { isKnownLogin, rememberKnownLogin } = require('../lib/knownLogin');
  const cookies = [];
  rememberKnownLogin({ tenantId: 't', headers: {} }, { append: (_name, value) => cookies.push(value) }, 'Owner@X.test');
  const cookie = cookies[0].split(';')[0];
  assert.equal(isKnownLogin({ tenantId: 't', headers: { cookie }, body: { email: 'owner@x.test' } }), true);
  assert.equal(isKnownLogin({ tenantId: 't', headers: { cookie }, body: { email: 'other@x.test' } }), false);
  assert.equal(isKnownLogin({ tenantId: 'other', headers: { cookie }, body: { email: 'owner@x.test' } }), false);
  assert.equal(isKnownLogin({ tenantId: 't', headers: { cookie: 'mahadKnownLogin=forged' }, body: { email: 'owner@x.test' } }), false);
});

test('an unknown account still pays for one password check', async () => {
  const { compareDummy } = require('../lib/passwordHash');
  const started = Date.now();
  assert.equal(await compareDummy('whatever'), false);
  await compareDummy('again');
  assert.ok(Date.now() - started > 20, 'the dummy compare costs a real bcrypt round');
});

test('a staff session is a shift; a customer keeps the long one; the cookie lasts as long as the token', () => {
  const { signAccessToken, setAuthCookie } = require('../lib/token');
  const identity = { uid: 'u', tenantId: 't', sessionVersion: 1, sessionId: 's' };
  const staff = jwt.decode(signAccessToken({ ...identity, isStaff: true }));
  const customer = jwt.decode(signAccessToken({ ...identity, isStaff: false }));
  assert.equal(staff.exp - staff.iat, 12 * 60 * 60);
  assert.equal(customer.exp - customer.iat, 7 * 24 * 60 * 60);
  const headers = {};
  const res = { getHeader: name => headers[name], setHeader: (name, value) => { headers[name] = value; } };
  setAuthCookie(res, signAccessToken({ ...identity, isStaff: true }));
  const maxAge = Number(/authToken=[^;]+;[^]*?Max-Age=(\d+)/.exec(headers['Set-Cookie'][0])[1]);
  assert.ok(maxAge <= 12 * 60 * 60 && maxAge > 12 * 60 * 60 - 60, String(maxAge));
});

test('outgoing webhooks refuse private addresses at connect time and never follow a redirect', async () => {
  const { isPrivateAddress, safeLookup, postWebhook } = require('../lib/webhookSecurity');
  assert.equal(isPrivateAddress('::ffff:10.0.0.1'), true);
  assert.equal(isPrivateAddress('::ffff:172.16.0.5'), true);
  await assert.rejects(new Promise((resolve, reject) => safeLookup('localhost', {}, (err, address) => (err ? reject(err) : resolve(address)))), /Private webhook/);
  await assert.rejects(() => postWebhook('http://127.0.0.1:9/hook', { body: {} }), /Private webhook/);
});

test('a signed Paymob payment pays the order it was opened for, not the one the unsigned field names', async () => {
  const { resolvePaymobMerchantOrder } = require('../lib/paymobFinalise');
  const { paymobSignedOrderId } = require('../lib/paymobHmac');
  assert.equal(paymobSignedOrderId({ order: { id: 555, merchant_order_id: 'x' } }), 555);
  assert.equal(paymobSignedOrderId({ order: '777' }), '777');
  const links = [{ paymob_order_id: '555', order_id: 'order-a' }, { paymob_order_id: '556', order_id: 'order-b' }];
  const db = {
    query: async (sql, params) => {
      if (/WHERE tenant_id=\? AND paymob_order_id=\?/.test(sql)) return [links.filter(l => l.paymob_order_id === params[1])];
      if (/WHERE tenant_id=\? AND order_id=\?/.test(sql)) return [links.filter(l => l.order_id === params[1])];
      throw new Error(`unexpected ${sql}`);
    },
  };
  const resolve = (merchantOrderId, signedOrderId) => resolvePaymobMerchantOrder({ merchantOrderId, signedOrderId, tenantId: 't' }, db);
  assert.equal(await resolve('order-a', '555'), 'order-a');
  assert.equal(await resolve('order-b', '555'), null, 'order A\'s payment replayed for order B');
  assert.equal(await resolve('order-b', '999'), null, 'an unknown Paymob order for an order that recorded its own');
  assert.equal(await resolve('order-legacy', '999'), 'order-legacy', 'an order opened before links existed');
});

test('client codes are drawn from the institute\'s own counter', async () => {
  const { getNextClientCode } = require('../lib/mappers');
  const counters = new Map([[null, 10385]]);
  const conn = {
    query: async (sql, params = []) => {
      if (/^UPDATE client_code_counter SET next_value = next_value \+ 1 WHERE tenant_id = \?/.test(sql)) {
        if (!counters.has(params[0])) return [{ affectedRows: 0 }];
        counters.set(params[0], counters.get(params[0]) + 1); return [{ affectedRows: 1 }];
      }
      if (/AS has_codes/.test(sql)) return [[{ has_codes: params[0] === 'old' ? 1 : 0 }]];
      if (/^INSERT IGNORE INTO client_code_counter/.test(sql)) { counters.set(params[0], params[1] ? counters.get(null) : 10001); return [{}]; }
      if (/SELECT next_value FROM client_code_counter WHERE tenant_id = \?/.test(sql)) return [[{ next_value: counters.get(params[0]) }]];
      throw new Error(`unexpected ${sql}`);
    },
  };
  assert.equal(await getNextClientCode(conn, 'new'), 'C10001');
  assert.equal(await getNextClientCode(conn, 'new'), 'C10002');
  assert.equal(await getNextClientCode(conn, 'old'), 'C10385');
  assert.equal(counters.get(null), 10385, 'the shared row is not drawn from');
});
