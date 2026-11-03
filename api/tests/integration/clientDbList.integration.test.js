'use strict';
/**
 * 3 Nov 2026, «قاعدة العملاء الموحدة … لازم يسمع كل عملاء السيستم»: the screen counted the 500 clients and 500 leads its browser had loaded. The numbers and the
 * pages now come from the server, over every client, lead and site sign-up in the caller's reach. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-clientdb-list-it';
let pool, router;

async function clean() {
  for (const table of ['payments', 'enrollments', 'courses', 'subscribers', 'leads', 'users']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}
const get = async (path, query = {}) => {
  const layer = router.stack.find(l => l.route?.path === path);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query, body: {}, headers: {}, tenantId: T, user: { uid: 'admin' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  return res;
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/misc/clientDbList');
  await clean();
  // 600 online clients (more than the 500 a browser page holds), 3 Dokki, 1 regular, 1 archived (not counted).
  const rows = [];
  for (let i = 0; i < 600; i += 1) rows.push([`cl-on-${i}`, T, `ON${i}`, `عميل أونلاين ${i}`, `10100${String(i).padStart(5, '0')}`, 'ONLINE_EGYPT', 'ONLINE_LOCAL_NEW', null]);
  for (let i = 0; i < 3; i += 1) rows.push([`cl-dq-${i}`, T, `DQ${i}`, `عميل دقي ${i}`, `10200${String(i).padStart(5, '0')}`, 'DAQQI', null, null]);
  rows.push(['cl-qt', T, 'QT1', 'عميل قطامية', '10300000001', 'OTHER', 'QATAMIYA', null]);
  rows.push(['cl-gone', T, 'GONE', 'عميل مؤرشف', '10400000001', 'ONLINE_EGYPT', null, '2026-10-01 10:00:00']);
  await pool.query('INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, client_type, deleted_at) VALUES ?', [rows]);
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, branch, hidden) VALUES
       ('ld-1', ?, 'ليد جديد', '10500000001', 'facebook', 'new', 'ONLINE_EGYPT', 0),
       ('ld-dup', ?, 'ليد هو نفسه عميل', '1010000000', 'facebook', 'new', 'ONLINE_EGYPT', 0),
       ('ld-conv', ?, 'ليد اتحول', '10500000002', 'facebook', 'converted', 'ONLINE_EGYPT', 0),
       ('ld-arch', ?, 'ليد مؤرشف', '10500000003', 'facebook', 'archived', 'ONLINE_EGYPT', 0)`, [T, T, T, T]);
  await pool.query("INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active) VALUES ('us-1', ?, 'x@x.t', NULL, 'x', 'مسجل بالموقع', 'user', 1)", [T]);
  await pool.query("INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp) VALUES ('co-1', ?, 'كورس أ', '', '', '', '', 'GENERAL', 'RECORDED', 900)", [T]);
  await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, status) VALUES (UUID(), ?, 'cl-on-1', 'co-1', NOW(), 'active')", [T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the counts are of every client, not of the page a browser holds', { skip }, async () => {
  const { body } = await get('/api/admin/client-db/summary');
  assert.deepEqual(
    [body.subscribers, body.online, body.daqqi, body.regular, body.leads, body.registrations, body.total],
    [604, 600, 3, 1, 1, 1, 606],
    'archived, converted and archived leads, and a lead who is already a client, are not counted again',
  );
});

test('the pages walk every person, in the order asked, with the filters of the screen', { skip }, async () => {
  const first = (await get('/api/admin/client-db/page', { type: 'subscriber', limit: '100', offset: '0', sort: 'name_asc' })).body;
  assert.equal(first.total, 604);
  assert.equal(first.rows.length, 100);
  const last = (await get('/api/admin/client-db/page', { type: 'subscriber', limit: '100', offset: '600' })).body;
  assert.equal(last.rows.length, 4, 'the 601st to 604th client are reachable, which the 500-row page never showed');
  assert.deepEqual((await get('/api/admin/client-db/page', { type: 'subscriber_daqqi' })).body.rows.map(r => r.clientCode).sort(), ['DQ0', 'DQ1', 'DQ2']);
  assert.equal((await get('/api/admin/client-db/page', { type: 'lead' })).body.total, 1);
  assert.equal((await get('/api/admin/client-db/page', { type: 'registration' })).body.rows[0].name, 'مسجل بالموقع');
  assert.equal((await get('/api/admin/client-db/page', { q: 'عميل دقي 1' })).body.rows[0].clientCode, 'DQ1');
  assert.equal((await get('/api/admin/client-db/page', { q: '10500000001' })).body.rows[0].kind, 'lead');
  const withCourse = (await get('/api/admin/client-db/page', { course: 'co-1' })).body;
  assert.deepEqual(withCourse.rows.map(r => [r.clientCode, r.courseNames]), [['ON1', 'كورس أ']]);
});
