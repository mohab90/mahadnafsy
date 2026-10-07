'use strict';

// The owner, 7 Oct 2026:
//   «ازاي هيا شايله 1921 عميل … اي حجز جديد بينزلها هيا فقط ليه ؟؟؟» — the
//   picker for one new client began its rotation at the first name every time,
//   so every booking went to «Doaa Awny», and so did the Dokki clients imported
//   the week her account was made. A Dokki or Tagamoa client is the branch's,
//   as the distribute button already had it.
//   «اي ليد غير بتوع السيلز خليه في محلي جديد» — Yasmin Farid was sales in
//   April and collection since, and still held 1,433 leads.
//
// Route handlers and the picker run against a scripted database.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-collection-secret-0123456789-abcdefghijklmnop';

const db = {
  calls: [],
  script: [],
  async query(sql, params = []) {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    db.calls.push({ sql: flat, params });
    for (const [pattern, answer] of db.script) {
      if (pattern.test(flat)) return typeof answer === 'function' ? answer(params, flat) : answer;
    }
    return /^(INSERT|UPDATE|DELETE)/i.test(flat) ? [{ affectedRows: 1 }] : [[]];
  },
  reset(script = []) { db.calls = []; db.script = script; },
  all(pattern) { return db.calls.filter(call => pattern.test(call.sql)); },
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query: (...args) => db.query(...args), execute: (...args) => db.query(...args), getConnection: async () => db },
  cached: async (_key, _ttl, fn) => fn(), cacheInvalidate() {},
  dbQuery: (...args) => db.query(...args), dbExecute: (...args) => db.query(...args),
  getStaffIdByEmail: async () => null, requireDb: (_req, _res, next) => next(), isDbDown: () => false,
});

const { pickCollectionOfficer } = require('../lib/collectionDistribution');

const handlerOf = (router, method, route) => {
  const layer = router.stack.find(item => item.route && item.route.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route} is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
async function call(handler, body) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  const req = { body, params: {}, query: {}, isSuperAdmin: true, staffRecord: null, user: { uid: 'u', email: 'owner@example.com' }, tenantId: 'tenant-default', headers: {}, ip: '127.0.0.1', get: () => undefined };
  await handler(req, res);
  return res;
}

const officers = [{ id: 'fatma', name: 'Fatma Mohamed' }, { id: 'doaa', name: 'Doaa Awny' }];

test('a new client goes to the officer who has waited longest, not to the first name', async () => {
  db.reset([[/FROM staff st LEFT JOIN/, [officers]]]);
  assert.deepEqual(await pickCollectionOfficer(db, 'tenant-default', { market: 'local', branch: 'ONLINE_EGYPT' }),
    { id: 'fatma', name: 'Fatma Mohamed' }, 'the first row the database orders is taken');
  const [staffQuery] = db.all(/FROM staff st LEFT JOIN/);
  assert.match(staffQuery.sql, /MAX\(assigned_cs_at\)/, 'ordered by the last client each one received');
  assert.match(staffQuery.sql, /ORDER BY got\.last_at IS NOT NULL, got\.last_at, st\.name$/,
    'someone who has never received one comes first, then the longest wait; the name only breaks a tie');
});

test('a Dokki or Tagamoa client gets no online collection officer', async () => {
  for (const branch of ['DAQQI', 'daqqi', 'TAGAMOA']) {
    db.reset([[/FROM staff st LEFT JOIN/, [officers]]]);
    assert.equal(await pickCollectionOfficer(db, 'tenant-default', { market: 'local', branch }), null, branch);
    assert.equal(db.calls.length, 0, `${branch}: not even asked who is free`);
  }
  db.reset([[/FROM staff st LEFT JOIN/, [officers]]]);
  assert.ok(await pickCollectionOfficer(db, 'tenant-default', { market: 'local', branch: 'ONLINE_SAUDI' }));
});

test('every path that makes a client says which branch it is for', () => {
  const fs = require('fs');
  const path = require('path');
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  for (const [file, count] of [['routes/admin/subscribers.js', 1], ['routes/admin/leads/convert.js', 1],
    ['routes/subscriber-payments.js', 2], ['lib/collectionSheets.js', 1]]) {
    const picks = read(file).split('pickCollectionOfficer(').slice(1).map(after => after.slice(0, 260));
    assert.equal(picks.length, count, file);
    picks.forEach(pick => assert.match(pick, /subscriberMarket\(\{[^}]*\}\),\s*branch\b/, `${file}: the branch is passed`));
  }
});

const staffRouter = require('../routes/staff');
const saveStaff = handlerOf(staffRouter, 'post', '/api/admin/staff');
const employee = role => ({ id: 'staff-yasmin', name: 'Yasmin Farid', email: 'yasmin@example.com', role });
const releases = () => db.all(/^UPDATE leads SET assigned_sales_id=NULL, assigned_sales_name=NULL/);

test('a rep moved out of sales hands their leads back to «محلي جديد»', async () => {
  db.reset([[/SELECT id, tenant_id, role, permissions_json, data_scope, branch_id FROM staff WHERE id=\?/,
    [[{ id: 'staff-yasmin', tenant_id: 'tenant-default', role: 'SALES', permissions_json: null, data_scope: null, branch_id: null }]]]]);
  const res = await call(saveStaff, employee('collection'));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [release] = releases();
  assert.ok(release, 'the leads are released');
  assert.deepEqual(release.params, ['tenant-default', 'staff-yasmin']);
});

test('saving a rep who stays in sales, or a new employee, touches no lead', async () => {
  db.reset([[/SELECT id, tenant_id, role, permissions_json, data_scope, branch_id FROM staff WHERE id=\?/,
    [[{ id: 'staff-yasmin', tenant_id: 'tenant-default', role: 'SALES', permissions_json: null, data_scope: null, branch_id: null }]]]]);
  assert.equal((await call(saveStaff, employee('sales'))).statusCode, 200);
  assert.equal(releases().length, 0, 'still sales');
  db.reset();
  assert.equal((await call(saveStaff, employee('collection'))).statusCode, 200);
  assert.equal(releases().length, 0, 'a new account holds nothing');
});
