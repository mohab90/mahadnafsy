'use strict';

// «اي عميل في صفحته لازم يكون في زر بيظهر للتحصيل وخدمة العملاء اسمه بيانات الشهادة
// يقدر يدخل فيه اسم العميل بالانجليزي وتاريخ الكورس البداية والنهاية والرقم القومي»
// (13 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

const stub = (rel, exports) => { const file = require.resolve(rel); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };

let subscriber;
let otherHolder = null;
const writes = [];
const connection = {
  beginTransaction: async () => {},
  commit: async () => { writes.push('COMMIT'); },
  rollback: async () => { writes.push('ROLLBACK'); },
  release() {},
  query: async (sql, params = []) => {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    if (/^SELECT id, name, name_en, national_id/.test(flat)) return [subscriber ? [subscriber] : []];
    if (/^SELECT name, client_code FROM subscribers WHERE tenant_id = \? AND national_id/.test(flat)) return [otherHolder ? [otherHolder] : []];
    writes.push({ sql: flat, params });
    return [[]];
  },
};
stub('../lib/db', { pool: { ...connection, getConnection: async () => connection } });
stub('../lib/logger', { error() {}, warn() {}, info() {} });
const pass = (req, res, next) => next();
stub('../middleware/auth', { requireAuth: pass, requireAdminOrStaff: pass, requirePermission: () => pass, requireAnyPermission: () => pass });
stub('../lib/clientHistory', { actorName: () => 'منى', logClientEvent: async (_conn, event) => { writes.push({ event }); } });

const router = require('../routes/misc/clientCertificateData');
const handlerOf = method => {
  const layer = router.stack.find(l => l.route && l.route.path === '/api/admin/subscribers/:id/certificate-data' && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
const put = handlerOf('put');
const staff = { id: 'st1', role: 'support', data_scope: 'all' };

async function call(body) {
  writes.length = 0;
  const out = {};
  await put({ tenantId: 't1', params: { id: 's1' }, body, staffRecord: staff, isSuperAdmin: false }, {
    status(code) { out.status = code; return this; }, json(value) { out.body = value; return this; },
  });
  return out;
}

test('customer service sets the English name, the national id and each course’s dates', async () => {
  subscriber = { id: 's1', name: 'أحمد علي', name_en: null, national_id: null, nationality: null, branch_id: 'branch-online-egypt' };
  const result = await call({
    nameEn: 'Ahmed Ali Hassan', nationalId: '29901011234567',
    courses: [{ courseId: 'c1', start: '2026-03-01', end: '2026-06-01' }, { courseId: 'c2', start: '2026-04-01', end: null }],
  });
  assert.equal(result.status, undefined);
  assert.deepEqual(result.body, { ok: true });
  const sql = writes.filter(w => w.sql).map(w => w.sql);
  assert.ok(sql.some(text => /UPDATE subscribers SET name_en = COALESCE\(\?, name_en\), national_id = COALESCE\(\?, national_id\)/.test(text)), 'the client keeps the name and the id');
  assert.equal(sql.filter(text => /^UPDATE enrollments SET course_start_date/.test(text)).length, 2, 'one update per course');
  assert.ok(sql.some(text => /^UPDATE certificate_requests SET course_start_date = COALESCE\(course_start_date, \?\)/.test(text)), 'an open request is filled from them');
  assert.ok(sql.some(text => /^UPDATE certificate_requests SET name_en = COALESCE\(NULLIF\(name_en, ''\), \?\)/.test(text)));
  assert.ok(writes.some(w => w.event && w.event.action === 'certificate_data'), 'the client’s history says who set it');
  assert.equal(writes.at(-1), 'COMMIT');
  const enrol = writes.find(w => w.sql && /^UPDATE enrollments/.test(w.sql));
  assert.deepEqual(enrol.params, ['2026-03-01', '2026-06-01', 't1', 's1', 'c1']);
});

test('an English name with Arabic letters, a bad Egyptian id and reversed dates are refused in Arabic', async () => {
  subscriber = { id: 's1', name: 'أحمد علي', name_en: null, national_id: null, nationality: null };
  const arabicName = await call({ nameEn: 'Ahmed أحمد Ali' });
  assert.equal(arabicName.status, 400);
  assert.equal(arabicName.body.code, 'NAME_EN_INVALID');
  const badId = await call({ nameEn: 'Ahmed Ali Hassan', nationalId: '123' });
  assert.equal(badId.status, 400);
  assert.equal(badId.body.code, 'NATIONAL_ID_INVALID');
  const reversed = await call({ nameEn: 'Ahmed Ali Hassan', courses: [{ courseId: 'c1', start: '2026-06-01', end: '2026-03-01' }] });
  assert.equal(reversed.status, 400);
  assert.equal(reversed.body.code, 'COURSE_DATES_INVALID');
  assert.equal(writes.at(-1), 'ROLLBACK');
  assert.ok(!writes.some(w => w.sql && /^UPDATE/.test(w.sql)), 'nothing was written');
});

test('a non-Egyptian client may carry a passport number, an Egyptian one only 14 digits', async () => {
  subscriber = { id: 's1', name: 'John Smith', name_en: null, national_id: null, nationality: 'INTERNATIONAL' };
  assert.deepEqual((await call({ nameEn: 'John Smith', nationalId: 'A1234567' })).body, { ok: true });
  subscriber = { ...subscriber, nationality: 'EGYPTIAN' };
  assert.equal((await call({ nationalId: 'A1234567' })).status, 400);
});

test('a national id already on another client stops the save and names them', async () => {
  subscriber = { id: 's1', name: 'أحمد علي', name_en: null, national_id: null, nationality: null };
  otherHolder = { name: 'منى سعيد', client_code: 'C55' };
  const result = await call({ nationalId: '29901011234567' });
  otherHolder = null;
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'NATIONAL_ID_TAKEN');
  assert.match(result.body.error, /منى سعيد \(C55\)/);
});

test('a client who is not there, or outside the caller’s scope, is not touched', async () => {
  subscriber = null;
  assert.equal((await call({ nameEn: 'Ahmed Ali Hassan' })).status, 404);
  subscriber = { id: 's1', name: 'x', branch_id: 'branch-daqqi', assigned_cs_id: 'other', assigned_sales_id: 'other' };
  writes.length = 0;
  const out = {};
  await put({ tenantId: 't1', params: { id: 's1' }, body: { nameEn: 'Ahmed Ali Hassan' }, staffRecord: { id: 'st2', role: 'collection', data_scope: 'assigned_cs' }, isSuperAdmin: false }, {
    status(code) { out.status = code; return this; }, json(value) { out.body = value; return this; },
  });
  assert.equal(out.status, 403);
  assert.ok(!writes.some(w => w.sql && /^UPDATE/.test(w.sql)));
});

test('the button is on a client’s page for those who hold one of the two permissions', () => {
  const permissions = read('admin/pages/unified-client/useUnifiedClientPermissions.ts');
  assert.match(permissions, /\['manage_certificates', 'manage_financial'\]\.some\(/);
  const page = read('admin/pages/UnifiedClientPage.tsx');
  assert.match(page, /onCertificateData=\{isSub && subscriber && canEditCertificateData \? \(\) => setCertificateDataOpen\(true\) : undefined\}/);
  assert.match(page, /<ClientCertificateDataModal/);
  assert.match(read('admin/pages/unified-client/UnifiedClientSidebarCards.tsx'), /بيانات الشهادة/);
  const modal = read('admin/pages/unified-client/ClientCertificateDataModal.tsx');
  assert.match(modal, /اسم العميل بالإنجليزي/);
  assert.match(modal, /الرقم القومي/);
  assert.match(modal, /type="date"/);
  assert.match(read('api/migrations/279_v26_enrollment_course_dates.sql'), /ADD COLUMN IF NOT EXISTS course_start_date DATE[\s\S]*course_end_date DATE/);
});
