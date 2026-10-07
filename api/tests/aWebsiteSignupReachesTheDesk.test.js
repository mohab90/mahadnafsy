'use strict';

// The website signs up at /api/user/signup; /api/auth/register is the other
// address. They were two copies «kept in sync», and the website's never wrote
// the lead or started the welcome journey: from 25 Sep to 7 Oct 2026, seven
// people who signed up on the site were in neither the leads nor the clients.
// Every source-reading test passed, because each copy still read right on its
// own — so this one runs the handlers.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-signup-secret-0123456789-abcdefghijklmnop';

const calls = [];
const conn = {
  async execute(sql, params) { calls.push({ sql: String(sql).replace(/\s+/g, ' '), params }); return [[]]; },
  async query(sql, params) { calls.push({ sql: String(sql).replace(/\s+/g, ' '), params }); return [[]]; },
  async beginTransaction() {}, async commit() { calls.push({ sql: 'COMMIT' }); }, async rollback() {}, release() {},
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query: (...a) => conn.query(...a), execute: (...a) => conn.execute(...a), getConnection: async () => conn },
  cached: async (_key, _ttl, fn) => fn(), cacheInvalidate() {},
  getStaffIdByEmail: async () => null, requireDb: (_req, _res, next) => next(), isDbDown: () => false,
});
stub('../lib/clientContext', {
  resolveClientContext: async () => ({ locationResolved: true, branch: 'ONLINE_EGYPT', countryCode: 'EG', currency: 'EGP' }),
  getClientIp: () => '127.0.0.1', hashClientIp: () => 'ip-hash',
});
const leads = [];
stub('../lib/registrationLead', { ensureLeadForUser: async (_conn, input) => { leads.push(input); return { created: true, leadId: 'L1' }; } });
stub('../lib/customerDevices', { registerCustomerDevice: async () => {} });
const journeys = [];
stub('../lib/lifecycle', { trigger: async (event, data, options) => { journeys.push({ event, data, options }); } });

const router = require('../routes/auth/registration');
const handlerOf = route => {
  const layer = router.stack.find(item => item.route && item.route.path === route && item.route.methods.post);
  assert.ok(layer, `${route} is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
async function signUp(route) {
  calls.length = 0; leads.length = 0; journeys.length = 0;
  const res = {
    statusCode: 200, body: null, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; },
    cookie() { return this; }, headers: {},
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    append(name, value) { this.headers[name.toLowerCase()] = value; return this; },
  };
  const req = {
    body: { name: 'منة الله', phone: '01012345678', password: 'long-enough-password' },
    tenantId: 'tenant-default', headers: { 'user-agent': 'test' }, ip: '127.0.0.1', get: () => undefined, cookies: {},
  };
  await handlerOf(route)(req, res);
  await new Promise(resolve => setImmediate(resolve));
  return res;
}

for (const route of ['/api/user/signup', '/api/auth/register']) {
  test(`${route}: the account, the lead and the welcome journey`, async () => {
    const res = await signUp(route);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.ok(calls.some(call => /^INSERT INTO users/.test(call.sql)), 'the login row is written');
    assert.equal(leads.length, 1, 'the person reaches the leads');
    assert.match(leads[0].user.phone, /1012345678$/, 'with the number they signed up with');
    assert.ok(calls.findIndex(call => call.sql === 'COMMIT') > calls.findIndex(call => /^INSERT INTO users/.test(call.sql)));
    assert.equal(journeys.length, 1, 'and the welcome journey starts');
    assert.equal(journeys[0].event, 'lead_created');
  });
}

test('the two addresses are one handler, so they cannot drift again', () => {
  assert.equal(handlerOf('/api/user/signup'), handlerOf('/api/auth/register'));
});
