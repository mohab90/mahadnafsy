'use strict';
/**
 * The Tagamoa branch runs on the Dokki section: rounds carry their branch, and a
 * branch's own staff see and touch only their branch. Against a real MariaDB;
 * runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-tagamoa-it';
let pool; let router;

const DOKKI_DESK = { id: 'st-tg-dq', name: 'ريسبشن الدقي', role: 'reception_daqqi', permissions: '["manage_daqqi"]' };
const TAGAMOA_DESK = { id: 'st-tg-tg', name: 'ريسبشن التجمع', role: 'reception_tagamoa', permissions: '["manage_daqqi"]' };

async function call(method, route, { params = {}, body = {}, query = {}, staff = null }) {
  const layer = router.stack.find(item => item.route?.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  const req = {
    params, body, query, headers: {}, tenantId: TENANT, user: { uid: 'u', email: 'x@example.test' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  };
  // The route's own guards after auth (branch reach, role sets), then its handler.
  const handlers = layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name));
  for (const handle of handlers) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['daqqi_attendees', 'daqqi_rounds', 'payments', 'subscribers', 'courses', 'activity_logs', 'audit_events']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  router = require('../../routes/daqqi-rounds');
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]).catch(() => {});
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type)
     VALUES ('co-tg-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED')`, [TENANT]);
  await pool.query(
    "INSERT INTO subscribers (id, tenant_id, name, phone, branch) VALUES ('sub-tg-1', ?, 'عميل التجمع', '1016000001', 'ONLINE_EGYPT')", [TENANT]);
  // No client is seated without a payment for the round's course (lib/daqqiHousing.js, 9 Oct 2026).
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, payment_type, status, date)
     VALUES ('pay-tg-1', ?, 'sub-tg-1', 'co-tg-1', 500, 'EGP', 'COURSE', 'paid', NOW())`, [TENANT]);
  await pool.query(
    `INSERT INTO daqqi_rounds (id, tenant_id, code, course_id, instructor_name, reception_name, day_of_week, start_date, time_slot, status, branch)
     VALUES ('rd-dq-1', ?, '9001', 'co-tg-1', '', '', 'السبت', '2026-10-10', 'EVENING', 'NEW', 'DAQQI')`, [TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

const ROUNDS = '/api/admin/daqqi-rounds';

test('a round made on the Tagamoa screen is a Tagamoa round', { skip }, async () => {
  const res = await call('post', ROUNDS, {
    body: { id: 'rd-tg-1', branch: 'TAGAMOA', courseId: 'co-tg-1', startDate: '2026-10-11', dayOfWeek: 'الأحد', timeSlot: 'مساءً', room: 'قاعة 1' },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [[row]] = await pool.query("SELECT branch FROM daqqi_rounds WHERE id='rd-tg-1'");
  assert.equal(row.branch, 'TAGAMOA');
});

test('each desk lists its own branch; the owner lists both', { skip }, async () => {
  const codes = res => res.body.map(round => `${round.branch}:${round.id}`).sort();
  assert.deepEqual(codes(await call('get', ROUNDS, { staff: DOKKI_DESK })), ['DAQQI:rd-dq-1']);
  assert.deepEqual(codes(await call('get', ROUNDS, { staff: TAGAMOA_DESK })), ['TAGAMOA:rd-tg-1']);
  assert.deepEqual(codes(await call('get', ROUNDS, {})), ['DAQQI:rd-dq-1', 'TAGAMOA:rd-tg-1']);
  assert.deepEqual(codes(await call('get', ROUNDS, { query: { branch: 'TAGAMOA' } })), ['TAGAMOA:rd-tg-1']);
});

test('the Dokki desk cannot open or seat into a Tagamoa round', { skip }, async () => {
  const seat = await call('post', `${ROUNDS}/:roundId/attendees`, { params: { roundId: 'rd-tg-1' }, body: { subscriberId: 'sub-tg-1' }, staff: DOKKI_DESK });
  assert.equal(seat.statusCode, 404);
  const create = await call('post', ROUNDS, { body: { branch: 'TAGAMOA', courseId: 'co-tg-1', startDate: '2026-10-12', dayOfWeek: 'الاثنين' }, staff: DOKKI_DESK });
  assert.equal(create.statusCode, 403);
});

test('seating a client in a Tagamoa round makes them a Tagamoa client', { skip }, async () => {
  const seat = await call('post', `${ROUNDS}/:roundId/attendees`, { params: { roundId: 'rd-tg-1' }, body: { subscriberId: 'sub-tg-1' }, staff: TAGAMOA_DESK });
  assert.equal(seat.statusCode, 200, JSON.stringify(seat.body));
  const [[sub]] = await pool.query("SELECT branch, branch_id FROM subscribers WHERE id='sub-tg-1' AND tenant_id=?", [TENANT]);
  assert.deepEqual([sub.branch, sub.branch_id], ['TAGAMOA', 'branch-tagamoa']);
});

test('a hall booked at Dokki is still free at Tagamoa', { skip }, async () => {
  await pool.query("UPDATE daqqi_rounds SET room='قاعة 1', day_of_week='الأحد', time_slot='EVENING' WHERE id='rd-dq-1'");
  const res = await call('post', ROUNDS, {
    body: { id: 'rd-tg-1', branch: 'TAGAMOA', courseId: 'co-tg-1', startDate: '2026-10-11', dayOfWeek: 'الأحد', timeSlot: 'مساءً', room: 'قاعة 1' },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});
