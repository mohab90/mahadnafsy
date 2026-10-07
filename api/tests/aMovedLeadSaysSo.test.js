'use strict';

// «لسه في مشاكل في حسابات الموظفين … اوقات الاخطاء بتكون في عملاء معينه فقط»
// (7 Oct 2026). From the production log, 6–7 Oct: a contact logged on a lead
// that had moved to another rep answered «Lead not found» (9 times), and a
// booking on one answered the same — the error showed on those clients only.
// They say what happened now, and a lead merged into another is that other one.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-moved-lead-secret-0123456789-abcdefghijklmnop';

const db = {
  calls: [], script: [],
  async query(sql, params = []) {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    db.calls.push({ sql: flat, params });
    for (const [pattern, answer] of db.script) if (pattern.test(flat)) return typeof answer === 'function' ? answer(params) : answer;
    return [[]];
  },
  reset(script = []) { db.calls = []; db.script = script; },
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query: (...a) => db.query(...a), execute: (...a) => db.query(...a), getConnection: async () => ({ ...db, query: (...a) => db.query(...a), async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} }) },
  cached: async (_k, _t, fn) => fn(), cacheInvalidate() {}, requireDb: (_q, _s, n) => n(), isDbDown: () => false,
  getStaffIdByEmail: async () => null,
});

const router = require('../routes/crm-advanced');
const handler = router.stack.find(l => l.route && l.route.path === '/api/admin/crm/leads/:id/interactions' && l.route.methods.get)
  .route.stack.slice(-1)[0].handle;
async function call(id) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { id }, query: {}, tenantId: 'tenant-default', staffRecord: { id: 'st-sama', role: 'SALES', permissions_json: null }, user: { uid: 'u' } }, res);
  return res;
}
const SCOPED = /FROM leads l WHERE id = \? AND l\.tenant_id = \?/;

test('a lead that moved to another rep says so, in the rep\'s words', async () => {
  db.reset([[SCOPED, [[]]], [/SELECT id, merged_into_lead_id FROM leads/, [[{ id: 'L1', merged_into_lead_id: null }]]]]);
  const res = await call('L1');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'LEAD_MOVED');
  assert.match(res.body.error, /اتنقل لحد تاني/);
});

test('a lead that is gone says that instead', async () => {
  db.reset([[SCOPED, [[]]], [/SELECT id, merged_into_lead_id FROM leads/, [[]]]]);
  const res = await call('L-gone');
  assert.equal(res.body.code, 'LEAD_NOT_FOUND');
});

test('a lead merged into another is that other one', async () => {
  db.reset([
    [SCOPED, params => (params[0] === 'L-target' ? [[{ id: 'L-target', tenant_id: 'tenant-default', status: 'contacted' }]] : [[]])],
    [/SELECT id, merged_into_lead_id FROM leads/, [[{ id: 'L-junk', merged_into_lead_id: 'L-target' }]]],
  ]);
  const res = await call('L-junk');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const reads = db.calls.filter(c => /FROM communications/.test(c.sql));
  assert.equal(reads[0].params[1], 'L-target');
});
