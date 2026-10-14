'use strict';

// «في صفحه الشهادات محتاجين يبقي تكمله لداتا العميل الاسم بالانجليزي ,, الرقم
// القومي ,,, تاريخ بداية الكورس وتاريخ النهايه» (8 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-cert-data-secret-0123456789-abcdefghijklmnop';

let request = null;
const writes = [];
const query = async (sql, params = []) => {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  if (/^SELECT \* FROM certificate_requests WHERE id=\?/.test(flat)) return [[request].filter(Boolean)];
  if (/^(UPDATE|INSERT)/.test(flat)) { writes.push({ sql: flat, params }); return [{ affectedRows: 1 }]; }
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

const router = require('../routes/certificates');
const route = router.stack.find(l => l.route && l.route.path === '/api/admin/certificate-requests/:id/client-data' && l.route.methods.put);
const handler = route.route.stack.slice(-1)[0].handle;
async function put(body) {
  writes.length = 0;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await handler({ params: { id: 'cr-1' }, tenantId: 't', body, user: { uid: 'u' }, staffRecord: { id: 'st', name: 'منى', role: 'support' } }, res);
  return res;
}

test('anyone on the desk completes the English name, the national ID and the dates', async () => {
  request = { id: 'cr-1', subscriber_id: 's-1', nationality: 'EGYPTIAN' };
  const res = await put({ nameEn: 'Yasmine Mohamed Elhady', idNumber: '29501011234567', courseStartDate: '2026-07-01', courseEndDate: '2026-09-30' });
  assert.equal(res.statusCode, 200);
  const [cert, client, history] = writes;
  // The name printed on it leads (10 Oct 2026); none typed leaves it as it is.
  assert.match(cert.sql, /^UPDATE certificate_requests SET name_ar=COALESCE\(\?, name_ar\), name_en=COALESCE\(\?, name_en\)/);
  assert.deepEqual(cert.params.slice(0, 5), [null, 'Yasmine Mohamed Elhady', '29501011234567', '2026-07-01', '2026-09-30']);
  assert.match(client.sql, /UPDATE subscribers SET name_en=COALESCE\(NULLIF\(name_en, ''\), \?\)/, 'and the client\'s record when it has none');
  assert.match(history.sql, /^INSERT INTO activity_logs/);
});

test('a wrong ID, a non-Latin English name, or an end before the start is refused', async () => {
  request = { id: 'cr-1', subscriber_id: 's-1', nationality: 'EGYPTIAN' };
  assert.equal((await put({ idNumber: '123' })).statusCode, 400);
  assert.equal((await put({ nameEn: 'ياسمين محمد' })).statusCode, 400);
  assert.equal((await put({ courseStartDate: '2026-09-30', courseEndDate: '2026-07-01' })).statusCode, 400);
  assert.equal(writes.length, 0);
});

test('a non-Egyptian keeps a passport number', async () => {
  request = { id: 'cr-1', subscriber_id: null, nationality: 'SAUDI' };
  const res = await put({ idNumber: 'a1234567' });
  assert.equal(res.statusCode, 200);
  assert.equal(writes[0].params[2], 'A1234567');
});
