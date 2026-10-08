'use strict';

// «زر اسمه تقييم … فقط للعملاء اللى متسكنه داخل الروندات … من 1 الي 10 في المحاضر
// وفي المادة العلميه وفي توصيل المعلومه وفي مسئولين الفرع … تظهر في صفحة حساب
// العميل … صفحه اسمها التقييمات … موشر … في صف العميل داخل الروند» (8 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-ratings-secret-0123456789-abcdefghijklmnopq';

const writes = [];
let housed = true;
let ratings = [];
const query = async (sql, params = []) => {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  if (/FROM daqqi_rounds r LEFT JOIN staff s/.test(flat)) {
    return [[{ id: 'r-1', code: '3018', branch: params[0] === 'r-tagamoa' ? 'TAGAMOA' : 'DAQQI', course_id: 'c-1', instructor_name: 'د. منى' }]];
  }
  if (/FROM daqqi_attendees/.test(flat)) return [housed ? [{ ok: 1 }] : []];
  if (/^INSERT INTO client_ratings/.test(flat)) { writes.push(params); return [{ affectedRows: 1 }]; }
  if (/FROM client_ratings WHERE tenant_id = \? AND round_id = \?/.test(flat)) return [ratings];
  return [[]];
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query, execute: query }, cached: async (_k, _t, fn) => fn(), cacheInvalidate() {},
  requireDb: (_q, _s, n) => n(), isDbDown: () => false, getStaffIdByEmail: async () => null,
});

const router = require('../routes/clientRatings');
const handlerOf = (method, route) => router.stack.find(l => l.route && l.route.path === route && l.route.methods[method]).route.stack.slice(-1)[0].handle;
async function call(method, route, req) {
  writes.length = 0;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handlerOf(method, route)({ tenantId: 't', params: { roundId: 'r-1' }, query: {}, user: { uid: 'u' }, staffRecord: { id: 'st-h', name: 'هنا', role: 'reception_daqqi' }, ...req }, res);
  return res;
}
const RATE = '/api/admin/daqqi-rounds/:roundId/ratings';

test('a housed client\'s four scores and note are kept, signed by name, with the round\'s lecturer', async () => {
  housed = true;
  const res = await call('post', RATE, { body: { subscriberId: 's-1', instructor: 9, material: 8, delivery: 7, branchStaff: 10, note: 'القاعة حرّ' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.average, 8.5);
  const [params] = writes;
  assert.deepEqual(params.slice(2, 12), ['s-1', 'r-1', 'DAQQI', 'c-1', 'د. منى', 9, 8, 7, 10, 'القاعة حرّ']);
  assert.equal(params[13], 'هنا', 'by name');
});

test('only for a client housed in the round, and every score from 1 to 10', async () => {
  housed = false;
  assert.equal((await call('post', RATE, { body: { subscriberId: 's-9', instructor: 9, material: 8, delivery: 7, branchStaff: 10 } })).statusCode, 409);
  housed = true;
  for (const bad of [0, 11, 7.5, '', null]) {
    const res = await call('post', RATE, { body: { subscriberId: 's-1', instructor: bad, material: 8, delivery: 7, branchStaff: 10 } });
    assert.equal(res.statusCode, 400, String(bad));
  }
  assert.equal(writes.length, 0);
});

test('a round at another branch is not there for a Dokki desk', async () => {
  const res = await call('post', RATE, { params: { roundId: 'r-tagamoa' }, body: { subscriberId: 's-1', instructor: 9, material: 8, delivery: 7, branchStaff: 10 } });
  assert.equal(res.statusCode, 404);
});

test('the round\'s rows get each client\'s latest rating and how many', async () => {
  ratings = [
    { subscriber_id: 's-1', instructor_score: 3, material_score: 4, delivery_score: 3, branch_staff_score: 6, note: 'مش فاهمة', created_at: '2026-10-08' },
    { subscriber_id: 's-1', instructor_score: 9, material_score: 9, delivery_score: 9, branch_staff_score: 9, note: null, created_at: '2026-10-01' },
    { subscriber_id: 's-2', instructor_score: 10, material_score: 9, delivery_score: 9, branch_staff_score: 8, note: null, created_at: '2026-10-05' },
  ];
  const res = await call('get', RATE, {});
  assert.deepEqual(res.body['s-1'], { average: 4, count: 2, at: '2026-10-08', note: 'مش فاهمة' });
  assert.equal(res.body['s-2'].average, 9);
});

test('who may: the administration, customer service and the branch desks; deleting is the administration\'s', () => {
  const { hasPermission } = require('../constants/permissions');
  for (const role of ['manager', 'support', 'daqqi_manager', 'reception_daqqi', 'tagamoa_manager', 'reception_tagamoa']) {
    assert.ok(hasPermission({ role }, 'manage_daqqi'), role);
  }
  assert.ok(!hasPermission({ role: 'sales' }, 'manage_daqqi'));
  const source = fs.readFileSync(path.join(__dirname, '../routes/clientRatings.js'), 'utf8');
  assert.match(source, /router\.delete\('\/api\/admin\/client-ratings\/:id', requireAuth, requireAdmin,/);
});

test('on the client\'s file, the round row and «التقييمات»', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
  assert.match(read('api/lib/customerTimeline.js'), /SELECT 'rating','rating',cr\.id,cr\.created_at/);
  const row = read('admin/pages/dashboard/tabs/daqqi/DaqqiRoundRow.tsx');
  assert.ok(row.indexOf('title="تقييم"') < row.indexOf('title="نقل لروند أخرى"'), 'before «نقل لروند أخرى»');
  assert.match(row, /\{mood\.emoji\} \{rated\.average\} · \{mood\.label\}/);
  assert.match(read('admin/pages/unified-client/UnifiedClientOverviewTab.tsx'), /<ClientSatisfactionCard events=\{timeline\} \/>/);
  assert.match(read('admin/pages/dashboard/dashboardShared.tsx'), /ratings: {12}'manage_daqqi',/);
});
