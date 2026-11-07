'use strict';
/**
 * «مين فاتح السيستم دلوقتي» (7 Nov 2026), over HTTP on the real app and a real MariaDB: the panel's beat and an employee's writes leave their trace in
 * staff_presence, at most one database write a minute per person; the screen is the owner's and the managers' only (view_presence: the admin sees it, sales and
 * support are refused, a signed-out caller is refused); each employee is online (< 2 min), idle (< 15 min) or offline by the time of their last sign of life; the
 * clients online come from their heartbeat with the page and the course; one tenant never sees another's people; and nothing in the answer is an address or a device.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, signInCustomer, ensureTenant } = require('./support/http');

const T = 'tenant-presence-it';
const OTHER = 'tenant-presence-it-other';
let pool; let app; let admin; let sales; let support; let customer; let presence;

const get = (session, path = '/api/admin/presence/now') => app.call('GET', path, { session });
const beat = (session, body) => app.call('POST', '/api/staff/presence', { session, body });
const seen = (staffKey, minutesAgo, extra = {}) => pool.query(
  `INSERT INTO staff_presence (tenant_id, staff_key, name, role, screen, last_seen_at, last_action_at, last_action_kind, last_action_label, seen_day, first_seen_at)
   VALUES (?, ?, ?, 'SALES', ?, UTC_TIMESTAMP() - INTERVAL ? MINUTE, ?, ?, ?, UTC_DATE(), UTC_TIMESTAMP() - INTERVAL 3 HOUR)
   ON DUPLICATE KEY UPDATE last_seen_at=VALUES(last_seen_at), screen=VALUES(screen), last_action_at=VALUES(last_action_at)`,
  [extra.tenant || T, staffKey, extra.name || staffKey, extra.screen || 'leads', minutesAgo,
    extra.acted === undefined ? null : new Date(Date.now() - extra.acted * 60000), extra.acted === undefined ? null : 'write', extra.label || null]);
const rowOf = async staffKey => (await pool.query('SELECT * FROM staff_presence WHERE tenant_id=? AND staff_key=?', [T, staffKey]))[0][0];
const person = (body, id) => body.staff.find(s => s.id === id);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  presence = require('../../lib/staffPresence');
  await ensureTenant(pool, T);
  await ensureTenant(pool, OTHER);
  app = await startApp(pool);
  admin = await signInStaff(pool, app, { tenantId: T, id: 'st-pr-admin', role: 'ADMIN', name: 'المدير' });
  sales = await signInStaff(pool, app, { tenantId: T, id: 'st-pr-sales', role: 'SALES', name: 'رنا' });
  support = await signInStaff(pool, app, { tenantId: T, id: 'st-pr-support', role: 'SUPPORT', name: 'منى' });
  customer = await signInCustomer(pool, app, { tenantId: T, id: 'sub-pr-1', name: 'عميلة' });
  await pool.query("INSERT INTO courses (id, tenant_id, slug, title, title_ar, description, short_description, instructor, thumbnail, category, type) VALUES ('c-pr-1', ?, 'c-pr-1', 'Anxiety', 'القلق', '', '', '', '', 'GENERAL', 'RECORDED')", [T]);
  // Four people the beat never touched: idle five minutes ago, offline half an hour ago, never seen, and one of another tenant.
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-pr-idle', ?, 'خاملة', 'idle@pr.test', '1011111111', 'SALES', 1, '2025-01-01'),
       ('st-pr-off', ?, 'غايب', 'off@pr.test', '1011111112', 'COLLECTION', 1, '2025-01-01'),
       ('st-pr-never', ?, 'لسه', 'never@pr.test', '1011111113', 'HR', 1, '2025-01-01'),
       ('st-pr-leaver', ?, 'استقال', 'leaver@pr.test', '1011111114', 'SALES', 0, '2025-01-01'),
       ('st-pr-other', ?, 'تينانت تانية', 'other@pr.test', '1011111115', 'SALES', 1, '2025-01-01')`,
    [T, T, T, T, OTHER]);
  await seen('st-pr-idle', 5, { acted: 6, label: 'تعديل ليد' });
  await seen('st-pr-off', 30, { acted: 31, label: 'إضافة دفعة' });
  await seen('st-pr-other', 1, { tenant: OTHER });
});

after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('the screen is the owner\'s and the managers\' only: admin 200, sales and support 403, signed out 401', { skip }, async () => {
  assert.equal((await get(admin)).status, 200);
  assert.equal((await get(sales)).status, 403);
  assert.equal((await get(support)).status, 403);
  assert.equal((await get(null)).status, 401);
});

test('a staff member can tick the permission for one person: view_presence opens it for sales', { skip }, async () => {
  const allowed = await signInStaff(pool, app, { tenantId: T, id: 'st-pr-ticked', role: 'SALES', permissions: ['view_dashboard', 'view_presence'] });
  assert.equal((await get(allowed)).status, 200);
});

test('the beat is allowed to every signed-in employee, the owner\'s screen is what it feeds, and a screen opened counts as an action', { skip }, async () => {
  assert.equal((await beat(sales, { screen: 'leads', opened: true })).status, 200);
  assert.equal((await beat(support, { screen: 'tickets', opened: false })).status, 200);
  assert.equal((await beat(null, { screen: 'leads' })).status, 401);
  const row = await rowOf('st-pr-sales');
  assert.equal(row.screen, 'leads');
  assert.equal(row.last_action_kind, 'screen');
  assert.equal(row.last_action_label, 'leads');
  // A bare beat (not a screen opened) marks them seen and nothing more.
  const bare = await rowOf('st-pr-support');
  assert.equal(bare.screen, 'tickets');
  assert.equal(bare.last_action_at, null);
});

test('a screen name that is not a screen name is not stored', { skip }, async () => {
  assert.equal((await beat(sales, { screen: '<script>alert(1)</script>', opened: true })).status, 200);
  assert.equal((await rowOf('st-pr-sales')).screen, 'leads');
});

test('each employee is online, idle or offline by the last sign of life, with the screen and the last action', { skip }, async () => {
  const { body } = await get(admin);
  assert.equal(person(body, 'st-pr-sales').status, 'online');
  assert.equal(person(body, 'st-pr-sales').screen, 'leads');
  assert.equal(person(body, 'st-pr-sales').lastActionKind, 'screen');
  assert.equal(person(body, 'st-pr-idle').status, 'idle');
  assert.equal(person(body, 'st-pr-idle').lastActionLabel, 'تعديل ليد');
  assert.equal(person(body, 'st-pr-off').status, 'offline');
  assert.equal(person(body, 'st-pr-never').status, 'offline');
  assert.equal(person(body, 'st-pr-never').lastSeenAt, null);
  assert.equal(person(body, 'st-pr-never').firstSeenToday, null);
  assert.ok(person(body, 'st-pr-sales').firstSeenToday, 'the first beat of the day is the sign-in time shown');
  // online first, then idle, then offline
  const order = body.staff.map(s => s.status);
  assert.deepEqual(order, [...order].sort((a, b) => ['online', 'idle', 'offline'].indexOf(a) - ['online', 'idle', 'offline'].indexOf(b)));
  assert.equal(body.counts.online + body.counts.idle + body.counts.offline, body.staff.length);
});

test('someone who left is not listed, and another tenant\'s people never are', { skip }, async () => {
  const { body } = await get(admin);
  assert.equal(person(body, 'st-pr-leaver'), undefined);
  assert.equal(person(body, 'st-pr-other'), undefined);
  assert.ok(!body.staff.some(s => s.name === 'تينانت تانية'));
});

test('the owner, who has no staff row, is listed as they introduced themselves', { skip }, async () => {
  await presence.notePresence({ tenantId: T, staffKey: 'owner-uid-1', name: 'المالك', role: 'OWNER' }, { screen: 'overview' });
  const { body } = await get(admin);
  const owner = person(body, 'owner-uid-1');
  assert.equal(owner.name, 'المالك');
  assert.equal(owner.status, 'online');
  assert.equal(owner.branchId, null);
});

test('never more than one database write a minute per person, however many beats and writes arrive', { skip }, async () => {
  const who = { tenantId: T, staffKey: 'st-pr-throttle', name: 'سرعة', role: 'SALES' };
  const base = Date.now();
  const wrote = [];
  for (let second = 0; second < 150; second += 5) {
    wrote.push(await presence.notePresence(who, { now: base + second * 1000, action: second % 10 === 0 ? { kind: 'write', label: 'تعديل ليد' } : null }));
  }
  // 30 events over 150 seconds: the first writes, then one a minute — at 0, 60 and 120 s.
  assert.equal(wrote.filter(Boolean).length, 3, JSON.stringify(wrote));
  // What waited in memory reaches the table at the next flush: the last action of the minute is the one stored.
  const row = await rowOf('st-pr-throttle');
  assert.equal(row.last_action_label, 'تعديل ليد');
  assert.equal(row.last_action_kind, 'write');
});

test('two instances merge: an older action never overwrites a newer one', { skip }, async () => {
  const who = { tenantId: T, staffKey: 'st-pr-merge', name: 'دمج', role: 'SALES' };
  const base = Date.now();
  await presence.notePresence(who, { now: base, action: { kind: 'write', label: 'الأحدث' } });
  presence.resetPresenceForTests();
  await presence.notePresence(who, { now: base - 90_000, action: { kind: 'write', label: 'الأقدم' } });
  assert.equal((await rowOf('st-pr-merge')).last_action_label, 'الأحدث');
});

test('a successful write by an employee is their last action, in words; the beat itself leaves no activity-log row', { skip }, async () => {
  const before = (await pool.query("SELECT COUNT(*) AS n FROM activity_logs WHERE tenant_id=? AND entity='presence'", [T]))[0][0].n;
  await beat(sales, { screen: 'leads', opened: true });
  const after = (await pool.query("SELECT COUNT(*) AS n FROM activity_logs WHERE tenant_id=? AND entity='presence'", [T]))[0][0].n;
  assert.equal(after, before);
  const res = await app.call('POST', '/api/admin/leads', { session: admin, body: { name: 'ليد جديد', phone: '01099990000', source: 'فيسبوك' } });
  assert.equal(res.status < 300, true, res.text);
  // The hook writes after the answer has gone: wait for the row, for a second at most.
  let row = null;
  for (let i = 0; i < 20 && !row; i++) { row = await rowOf('st-pr-admin'); if (!row) await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(row, 'the first write of a person reaches the table');
  assert.equal(row.last_action_kind, 'write');
  assert.match(row.last_action_label, /ليد/);
});

test('clients online now: the count, the page they are on and the course, from their own heartbeat', { skip }, async () => {
  const hb = await app.call('POST', '/api/me/heartbeat', { session: customer, body: { name: 'عميلة', page: 'learning', courseId: 'c-pr-1' } });
  assert.equal(hb.status, 200, hb.text);
  const { body } = await get(admin);
  assert.equal(body.clients.count, 1);
  assert.equal(body.clients.list[0].page, 'learning');
  assert.equal(body.clients.list[0].courseTitle, 'القلق');
  // Hostile values are dropped, not stored.
  await app.call('POST', '/api/me/heartbeat', { session: customer, body: { page: '<x>', courseId: "x';drop" } });
  const again = (await get(admin)).body.clients.list[0];
  assert.equal(again.page, null);
  assert.equal(again.courseTitle, null);
});

test('no address and no device anywhere in the answer', { skip }, async () => {
  const { text } = await get(admin);
  const keys = [];
  JSON.parse(text, (key, value) => { keys.push(key); return value; });
  assert.deepEqual(keys.filter(key => /^(ip|ips|ipAddress|ip_hash|device|devices|userAgent|user_agent|agent)$/i.test(key)), []);
  assert.doesNotMatch(text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
});

test('the beat does not empty the held figures (it is one of the quiet writes)', { skip }, async () => {
  const { isQuietWrite } = require('../../lib/httpApp');
  assert.equal(isQuietWrite('/api/staff/presence'), true);
});
