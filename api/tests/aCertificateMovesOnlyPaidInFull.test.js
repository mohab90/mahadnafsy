'use strict';

// «مينفعش يترفع شهاده والمدفوع 0 … مينفعش تقول السعر اكتمل غير لما يطابق السعر
// عندك في السيستم … عند المديرين اقدر امسح شهاده واقدر اعدل شهاده، ويبقي للكل
// يقدر يعمل تغير حالة الشهاده … والحالات هتكون كالاتي فقط» (8 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-cert-gate-secret-0123456789-abcdefghijklmnopq';

let request = null;
const updates = [];
const query = async (sql, params = []) => {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  if (/^SELECT \* FROM certificate_requests WHERE id=\?/.test(flat)) return [[request]];
  if (/FROM payments WHERE certificate_request_id=\?/.test(flat)) return [[]];
  if (/FROM enrollments e|EXISTS\(SELECT 1 FROM enrollments/.test(flat)) return [[{ course_taken: 0, completion_revoked: 0 }]];
  if (/^UPDATE certificate_requests SET/.test(flat)) { updates.push({ sql: flat, params }); return [{ affectedRows: 1 }]; }
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
// The price list: the American Board is 1,800.
stub('../lib/tenantSettings', {
  getTenantSetting: async () => ({ extra_cert_pricing: JSON.stringify({ american_board: { egyptianEGP: 1800 } }) }),
  setTenantSetting: async () => {},
});
stub('../lib/clientHistory', { actorName: () => 'هنا', logClientEvent: async () => {} });

const router = require('../routes/certificates');
const handlerOf = (method, path) => router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]).route.stack.slice(-1)[0].handle;

async function call(method, path, req) {
  updates.length = 0;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handlerOf(method, path)({ params: { id: 'cr-1' }, tenantId: 't', body: {}, user: { uid: 'u' }, ...req }, res);
  return res;
}
const support = { staffRecord: { id: 'st-cs', role: 'SUPPORT' } };
const manager = { staffRecord: { id: 'st-m', role: 'MANAGER' } };

test('half paid stays «في انتظار تأكيد الدفعة» — the price list says 1,800', async () => {
  request = { id: 'cr-1', subscriber_id: 's-1', course_id: null, type: 'AMERICAN_BOARD', status: 'PRICED', price: 900, paid_amount: 900, currency: 'EGP' };
  const res = await call('patch', '/api/admin/certificate-requests/:id', { ...support, body: { status: 'IN_PROGRESS' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CERTIFICATE_NOT_PAID');
  assert.match(res.body.error, /900 من 1,800/);
  assert.equal(updates.length, 0, 'a price typed equal to the part paid does not make it paid');
});

test('paid in full, anyone on the desk moves it, and freely between the paid stages', async () => {
  request = { id: 'cr-1', subscriber_id: 's-1', course_id: null, type: 'AMERICAN_BOARD', status: 'PRICED', price: 1800, paid_amount: 1800, currency: 'EGP' };
  assert.equal((await call('patch', '/api/admin/certificate-requests/:id', { ...support, body: { status: 'IN_PROGRESS' } })).statusCode, 200);
  request = { ...request, status: 'DELIVERED' };
  assert.equal((await call('patch', '/api/admin/certificate-requests/:id', { ...support, body: { status: 'RETURNED' } })).statusCode, 200, 'back from the client');
  request = { ...request, status: 'SHIPPED' };
  assert.equal((await call('patch', '/api/admin/certificate-requests/:id', { ...support, body: { status: 'PAID' } })).statusCode, 200, 'back to review');
});

test('a certificate paid in full at its price moves on after the price list rises; one paid nothing does not', async () => {
  request = { id: 'cr-1', subscriber_id: 's-1', course_id: null, type: 'AMERICAN_BOARD', status: 'IN_PROGRESS', price: 1500, paid_amount: 1500, currency: 'EGP' };
  assert.equal((await call('patch', '/api/admin/certificate-requests/:id', { ...support, body: { status: 'AT_BRANCH' } })).statusCode, 200);
  request = { ...request, status: 'PAID', price: 1800, paid_amount: 0 };
  assert.equal((await call('patch', '/api/admin/certificate-requests/:id', { ...support, body: { status: 'IN_PROGRESS' } })).statusCode, 409);
});

test('editing and deleting a certificate are the managers\'', async () => {
  request = { id: 'cr-1', subscriber_id: 's-1', type: 'AMERICAN_BOARD', status: 'PAID', price: 1800, paid_amount: 1800, currency: 'EGP' };
  assert.equal((await call('put', '/api/admin/certificate-requests/:id/details', { ...support, body: { nameAr: 'x' } })).statusCode, 403);
  assert.equal((await call('delete', '/api/admin/certificate-requests/:id', support)).statusCode, 403);
  assert.notEqual((await call('put', '/api/admin/certificate-requests/:id/details', { ...manager, body: { adminNote: 'ok' } })).statusCode, 403);
});

test('a three-part name is the certificate\'s; a shorter one is asked for', () => {
  const { certificateNameOf } = require('../lib/certificatePayments');
  assert.equal(certificateNameOf('ياسمين  محمد الهادي'), 'ياسمين محمد الهادي');
  assert.equal(certificateNameOf('هبه محمد'), null);
});
