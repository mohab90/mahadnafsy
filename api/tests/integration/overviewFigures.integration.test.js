'use strict';
/**
 * GET /api/admin/subscribers/stats?overview=1 against a real MariaDB: الرئيسية's
 * «عملاء أونلاين اليوم» and «أكثر الكورسات تسجيلاً», counted by the database now
 * that the screen loads no client rows (admin siteLists.ts, 11 Oct 2026).
 * Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-overview-it';
let pool, router;

async function stats(query, staff) {
  const layer = router.stack.find(l => l.route?.path === '/api/admin/subscribers/stats');
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({
    params: {}, query, body: {}, headers: {}, tenantId: TENANT, user: { uid: staff?.id || 'admin' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}
async function clean() {
  await pool.query('DELETE FROM enrollments WHERE tenant_id=?', [TENANT]);
  await pool.query('DELETE FROM subscribers WHERE tenant_id=?', [TENANT]);
  await pool.query('DELETE FROM courses WHERE tenant_id=?', [TENANT]);
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/admin/stafflists');
  await clean();
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, is_active, created_at) VALUES
       ('ov-sub-1', ?, 'اليوم ١', '1016660001', 'ONLINE_EGYPT', 1, UTC_TIMESTAMP()),
       ('ov-sub-2', ?, 'اليوم ٢', '1016660002', 'DAQQI', 1, UTC_TIMESTAMP()),
       ('ov-sub-3', ?, 'قديم', '1016660003', 'DAQQI', 1, UTC_TIMESTAMP() - INTERVAL 10 DAY),
       ('ov-sub-4', ?, 'مؤرشف', '1016660004', 'DAQQI', 1, UTC_TIMESTAMP())`, [TENANT, TENANT, TENANT, TENANT]);
  await pool.query("UPDATE subscribers SET deleted_at=NOW() WHERE id='ov-sub-4'");
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, slug, description, short_description, instructor, thumbnail, category, type) VALUES
       ('ov-course-a', ?, 'أ', 'ov-course-a', '', '', '', '', 'GENERAL', 'RECORDED'),
       ('ov-course-b', ?, 'ب', 'ov-course-b', '', '', '', '', 'GENERAL', 'RECORDED')`,
    [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, status) VALUES
       ('ov-en-1', ?, 'ov-sub-1', 'ov-course-a', NOW(), 'active'),
       ('ov-en-2', ?, 'ov-sub-3', 'ov-course-a', NOW(), 'active'),
       ('ov-en-3', ?, 'ov-sub-2', 'ov-course-b', NOW(), 'active'),
       ('ov-en-4', ?, 'ov-sub-4', 'ov-course-b', NOW(), 'active')`, [TENANT, TENANT, TENANT, TENANT]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('overview=1 adds today\'s clients and each course\'s clients, archived clients left out', { skip }, async () => {
  const { statusCode, body } = await stats({ overview: '1' });
  assert.equal(statusCode, 200, JSON.stringify(body));
  assert.equal(body.total, 3);
  assert.equal(body.createdToday, 2);
  assert.deepEqual(body.byCourse, { 'ov-course-a': 2, 'ov-course-b': 1 });
});

test('without it the answer is what the other screens always had', { skip }, async () => {
  const { body } = await stats({});
  assert.equal(body.createdToday, undefined);
  assert.equal(body.byCourse, undefined);
});

test('a branch manager\'s figures are their branch\'s', { skip }, async () => {
  const manager = { id: 'ov-mgr', role: 'daqqi_manager', tenant_id: TENANT, data_scope: 'branch:DAQQI' };
  const { body } = await stats({ overview: '1' }, manager);
  assert.equal(body.total, 2);
  assert.equal(body.createdToday, 1);
  assert.deepEqual(body.byCourse, { 'ov-course-a': 1, 'ov-course-b': 1 });
});
