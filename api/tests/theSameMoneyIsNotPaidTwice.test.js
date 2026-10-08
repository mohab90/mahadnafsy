'use strict';

// «شوية ظاهر ان المدفوع 700 وشوية 1400 ليه؟ … مينفعش نغلط ابدا في الفلوس»
// (8 Oct 2026). A 700 recorded as a payment was typed 25 seconds later as
// «مدفوع قبل السيستم» on the same course — 10 clients so, on 5–7 Oct. Money
// added there that matches a payment recorded on the course in the last two
// days is asked about before it is saved.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-prior-paid-secret-0123456789-abcdefghijklmn';

let recentPayments = [];
let currentPrior = 0;
const writes = [];
const query = async (sql, params = []) => {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  if (/SELECT crm_json FROM subscribers/.test(flat)) return [[{ crm_json: JSON.stringify({ priorPaid: currentPrior ? { 'c-1': currentPrior } : {} }) }]];
  if (/FROM payments WHERE tenant_id=\? AND subscriber_id=\? AND deleted_at IS NULL AND status='paid' AND amount > 0/.test(flat)) return [recentPayments.map(amount => ({ amount }))];
  if (/^UPDATE subscribers SET crm_json/.test(flat)) { writes.push(params[0]); return [{ affectedRows: 1 }]; }
  if (/FROM subscribers/.test(flat)) return [[{ id: 's-1', tenant_id: 't', branch: 'ONLINE_EGYPT', crm_json: '{}', assigned_cs_id: null, assigned_sales_id: null }]];
  return [[]];
};
const conn = { query, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query, execute: query, getConnection: async () => conn },
  cached: async (_k, _t, fn) => fn(), cacheInvalidate() {}, requireDb: (_q, _s, n) => n(), isDbDown: () => false,
  getStaffIdByEmail: async () => null,
});
const router = require('../routes/core/content');
const layer = router.stack.find(l => l.route && l.route.path === '/api/admin/subscribers/:id/item-money' && l.route.methods.put);
const handler = layer.route.stack.slice(-1)[0].handle;

async function save(body) {
  writes.length = 0;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ params: { id: 's-1' }, body: { item: 'c-1', expected: 2800, ...body }, tenantId: 't', isSuperAdmin: true, user: { uid: 'u' } }, res);
  return res;
}

test('the 700 just recorded is not taken again as paid before the system', async () => {
  recentPayments = [700]; currentPrior = 0;
  const res = await save({ priorPaid: 700 });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'PRIOR_PAID_LOOKS_RECORDED');
  assert.match(res.body.error, /هتتحسب مرتين/);
});

test('confirmed as other money, it is saved; money that matches nothing is saved at once', async () => {
  recentPayments = [700]; currentPrior = 0;
  assert.notEqual((await save({ priorPaid: 700, confirmNotRecorded: true })).statusCode, 409);
  recentPayments = [700]; currentPrior = 0;
  assert.notEqual((await save({ priorPaid: 1500 })).statusCode, 409);
  recentPayments = [700]; currentPrior = 700;
  assert.notEqual((await save({ priorPaid: 700 })).statusCode, 409, 'nothing added');
});
