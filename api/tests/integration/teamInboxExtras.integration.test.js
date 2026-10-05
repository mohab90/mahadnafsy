'use strict';
/**
 * صندوق الرسائل's labels, internal notes, saved answers and reply-speed board,
 * against a real MariaDB. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-inboxx-it';
let pool; let router;

const REP = { id: 'st-ix-rep', name: 'مندوبة', role: 'sales', permissions: '["manage_inbox"]' };
const OTHER = { id: 'st-ix-two', name: 'زميل', role: 'sales', permissions: '["manage_inbox"]' };

async function call(method, route, { params = {}, body = {}, query = {}, staff = REP } = {}) {
  const layer = router.stack.find(item => item.route?.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await layer.route.stack.at(-1).handle({
    params, body, query, headers: {}, tenantId: TENANT, user: { uid: 'u', email: 'x@example.test' },
    staffRecord: staff, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}

async function clean() {
  for (const table of ['inbox_notes', 'inbox_quick_replies', 'communications', 'inbox_threads', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  router = require('../../routes/team-inbox');
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, commission_rate) VALUES
       ('st-ix-rep', ?, 'مندوبة', 'rep-ix@example.test', '1018000001', 'SALES', 1, '2025-01-01', 0),
       ('st-ix-two', ?, 'زميل', 'two-ix@example.test', '1018000002', 'SALES', 1, '2025-01-01', 0)`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO inbox_threads (id, tenant_id, platform, contact_key, contact_name, assigned_staff_id, status, last_direction, last_message_at, last_inbound_at)
     VALUES ('th-ix-1', ?, 'whatsapp', '201018000003', 'عميلة', 'st-ix-rep', 'open', 'IN', NOW() - INTERVAL 5 MINUTE, NOW() - INTERVAL 5 MINUTE)`, [TENANT]);
  await pool.query(
    `INSERT INTO communications (id, tenant_id, type, direction, date, notes, thread_id, staff_id, outcome, created_at) VALUES
       ('cm-ix-1', ?, 'WHATSAPP', 'IN',  NOW() - INTERVAL 30 MINUTE, 'سلام', 'th-ix-1', NULL, NULL, NOW()),
       ('cm-ix-2', ?, 'WHATSAPP', 'OUT', NOW() - INTERVAL 20 MINUTE, 'أهلاً', 'th-ix-1', 'st-ix-rep', NULL, NOW()),
       ('cm-ix-3', ?, 'WHATSAPP', 'IN',  NOW() - INTERVAL 10 MINUTE, 'السعر؟', 'th-ix-1', NULL, NULL, NOW()),
       ('cm-ix-4', ?, 'WHATSAPP', 'OUT', NOW() - INTERVAL 9 MINUTE, 'بوت', 'th-ix-1', NULL, 'BOT', NOW())`, [TENANT, TENANT, TENANT, TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('labels are cleaned, de-duplicated, capped, and filter the list', { skip }, async () => {
  const saved = await call('post', '/api/admin/team-inbox/threads/:id/labels', { params: { id: 'th-ix-1' }, body: { labels: ['  سأل   عن السعر ', 'سأل عن السعر', 'حجز'] } });
  assert.deepEqual(saved.body.labels, ['سأل عن السعر', 'حجز']);
  const list = await call('get', '/api/admin/team-inbox/threads', { query: { view: 'mine', label: 'حجز' } });
  assert.deepEqual(list.body.threads.map(t => t.id), ['th-ix-1']);
  assert.deepEqual(list.body.threads[0].labels, ['سأل عن السعر', 'حجز']);
  const none = await call('get', '/api/admin/team-inbox/threads', { query: { view: 'mine', label: 'شكوى' } });
  assert.equal(none.body.threads.length, 0);
});

test('a note shows in the conversation, and a colleague cannot open someone else\'s', { skip }, async () => {
  await call('post', '/api/admin/team-inbox/threads/:id/notes', { params: { id: 'th-ix-1' }, body: { body: 'كلّمها بكرة' } });
  const thread = await call('get', '/api/admin/team-inbox/threads/:id', { params: { id: 'th-ix-1' } });
  assert.deepEqual(thread.body.notes.map(n => [n.body, n.staff_name]), [['كلّمها بكرة', 'مندوبة']]);
  assert.equal(thread.body.messages.find(m => m.id === 'cm-ix-4').by_bot, 1);
  const blocked = await call('post', '/api/admin/team-inbox/threads/:id/notes', { params: { id: 'th-ix-1' }, body: { body: 'x' }, staff: OTHER });
  assert.equal(blocked.statusCode, 403);
});

test('saved answers: shortcut is unique, and only its writer edits it', { skip }, async () => {
  const made = await call('post', '/api/admin/team-inbox/quick-replies', { body: { title: 'سعر CBT', shortcut: '/CBT', body: 'أهلاً {name}' } });
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  const clash = await call('post', '/api/admin/team-inbox/quick-replies', { body: { title: 'تاني', shortcut: 'cbt', body: 'x' }, staff: OTHER });
  assert.equal(clash.statusCode, 409);
  const edit = await call('put', '/api/admin/team-inbox/quick-replies/:id', { params: { id: made.body.id }, body: { title: 'x', body: 'y' }, staff: OTHER });
  assert.equal(edit.statusCode, 403);
  const list = await call('get', '/api/admin/team-inbox/quick-replies');
  assert.deepEqual(list.body.map(r => r.shortcut), ['cbt']);
});

test('reply speed: the rep and the bot each counted from the message they answered', { skip }, async () => {
  const stats = await call('get', '/api/admin/team-inbox/stats', { query: { days: 1 } });
  const byName = Object.fromEntries(stats.body.people.map(p => [p.name, p]));
  assert.equal(byName['مندوبة'].replies, 1);
  assert.equal(byName['مندوبة'].avgMinutes, 10);
  assert.equal(byName['🤖 البوت'].avgMinutes, 1);
  assert.equal(stats.body.waitingNow, 1);
});
