'use strict';
/**
 * 3 Nov 2026 (second round), against a real MariaDB: a site account linked to its client record by a member of the staff (and found by the sign-in resolver
 * after), a sharing lock that stays lifted, a manager's penalty in days, and the leave balance that refuses a day when the 21 are gone. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-shared-accounts-it';
let pool, searchRouter, compensationRouter, attendanceRouter, analyticsRouter;

async function clean() {
  for (const table of ['activity_logs', 'login_history', 'employee_bonuses', 'attendance_logs', 'subscribers', 'users', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
}
const handler = (router, method, path) => router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle;
async function call(router, method, path, { body = {}, query = {}, params = {} } = {}) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await handler(router, method, path)({
    params, query, body, headers: {}, tenantId: T, user: { uid: 'sa-hr', email: 'hr@x.t' }, staffRecord: { id: 'sa-hr', name: 'مسؤول' },
    isSuperAdmin: true, ip: '1', get: () => undefined,
  }, res);
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  searchRouter = require('../../routes/misc/clientDbSearch');
  compensationRouter = require('../../routes/hr/compensation');
  attendanceRouter = require('../../routes/hr/attendance');
  analyticsRouter = require('../../routes/misc/analytics');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Shared accounts IT', 'suspended')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, base_salary) VALUES
       ('sa-hr', ?, 'مسؤول', 'sa0@x.t', '1018000000', 'MANAGER', 1, '2025-01-01', NULL),
       ('sa-mona', ?, 'منى', 'sa1@x.t', '1018000001', 'SALES', 1, '2025-01-01', 9000)`, [T, T]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, client_code, name, phone, email, branch, is_active, created_at) VALUES
       ('sa-sub', ?, 'C140492', 'شعاع حسين محمد صميلى', '966532190549', NULL, 'ONLINE_SAUDI', 1, NOW()),
       ('sa-other', ?, 'C777', 'شعاع محمود', '966500000000', NULL, 'ONLINE_SAUDI', 1, NOW())`, [T, T]);
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active) VALUES
       ('sa-user', ?, 'shoaa@x.test', NULL, 'x', 'شعاع حسين محمد صميلي', 'user', 1)`, [T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the sign-up with the same name is offered as a candidate, and linking it makes the client\'s courses theirs', { skip }, async () => {
  const offered = await call(searchRouter, 'get', '/api/admin/site-accounts/:userId/candidates', { params: { userId: 'sa-user' } });
  assert.equal(offered.statusCode, 200);
  assert.deepEqual(offered.body.candidates.map(c => c.clientCode), ['C140492'], 'the other Shoaa shares one word only');

  const resolverFirst = await require('../../lib/subscriberIdentity').resolveSubscriberRow({ tenantId: T, user: { uid: 'sa-user' } }, ['id']);
  assert.equal(resolverFirst, null, 'before the link the account finds nobody — the empty account');

  const linked = await call(searchRouter, 'post', '/api/admin/site-accounts/:userId/link', { params: { userId: 'sa-user' }, body: { subscriberId: 'sa-sub' } });
  assert.equal(linked.statusCode, 200, JSON.stringify(linked.body));
  const [[sub]] = await pool.query("SELECT firebase_uid, email FROM subscribers WHERE tenant_id=? AND id='sa-sub'", [T]);
  assert.deepEqual([sub.firebase_uid, sub.email], ['sa-user', 'shoaa@x.test']);
  const found = await require('../../lib/subscriberIdentity').resolveSubscriberRow({ tenantId: T, user: { uid: 'sa-user' } }, ['id']);
  assert.equal(found.id, 'sa-sub');
  const [history] = await pool.query("SELECT actor, label FROM activity_logs WHERE tenant_id=? AND entity_id='sa-sub' AND action='site_account_linked'", [T]);
  assert.equal(history.length, 1, 'the client\'s history says it was linked, and by whom');
  assert.equal(history[0].actor, 'مسؤول');

  const again = await call(searchRouter, 'post', '/api/admin/site-accounts/:userId/link', { params: { userId: 'sa-user' }, body: { subscriberId: 'sa-sub' } });
  assert.equal(again.body.already, true);
  const stolen = await call(searchRouter, 'post', '/api/admin/site-accounts/:userId/link', { params: { userId: 'sa-user' }, body: { subscriberId: 'sa-other' } });
  assert.equal(stolen.statusCode, 409, 'an account that already owns a record is not moved without saying so');
  assert.equal(stolen.body.code, 'ACCOUNT_HAS_CLIENT');
});

test('after a lock is lifted the next sign-in does not lock the account again from the same devices', { skip }, async () => {
  const { enforceSharingLimit } = require('../../lib/accountSharingGuard');
  for (let i = 0; i < 5; i += 1) {
    await pool.query(
      `INSERT INTO login_history (tenant_id, user_id, email, ip, status, device_hash, created_at) VALUES (?, 'sa-user', 'shoaa@x.test', ?, 'success', ?, NOW() - INTERVAL 1 HOUR)`,
      [T, `41.0.0.${i}`, `device-${i}`]);
  }
  const locked = await enforceSharingLimit({ tenantId: T, userId: 'sa-user', email: 'shoaa@x.test' });
  assert.equal(locked.locked, true);
  const unlocked = await call(analyticsRouter, 'post', '/api/admin/security/accounts/:id/unlock', { params: { id: 'sa-user' } });
  assert.equal(unlocked.statusCode, 200);
  const after = await enforceSharingLimit({ tenantId: T, userId: 'sa-user', email: 'shoaa@x.test' });
  assert.deepEqual([after.locked, after.distinctDevices], [false, 0], 'the devices from before the unlock no longer count');
  await pool.query(
    "INSERT INTO login_history (tenant_id, user_id, email, ip, status, device_hash) VALUES (?, 'sa-user', 'shoaa@x.test', '41.9.9.9', 'success', 'device-new')", [T]);
  assert.equal((await enforceSharingLimit({ tenantId: T, userId: 'sa-user', email: 'shoaa@x.test' })).distinctDevices, 1, 'a new sign-in counts from the unlock on');
});

test('a manager\'s penalty in days is a thirtieth of the salary each, with its reason, and waits for approval unless the owner gives it', { skip }, async () => {
  const none = await call(compensationRouter, 'post', '/api/admin/hr/month-penalties', { body: { staffId: 'sa-mona', month: 10, year: 2026, days: 1 } });
  assert.equal(none.statusCode, 400, 'no reason, no penalty');
  const both = await call(compensationRouter, 'post', '/api/admin/hr/month-penalties', { body: { staffId: 'sa-mona', month: 10, year: 2026, days: 1, amount: 50, reason: 'x' } });
  assert.equal(both.statusCode, 400, 'an amount or days, not both');
  const made = await call(compensationRouter, 'post', '/api/admin/hr/month-penalties', { body: { staffId: 'sa-mona', month: 10, year: 2026, days: 1.5, reason: 'تأخير متكرر' } });
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  assert.equal(made.body.amount, 450);
  assert.equal(made.body.status, 'PENDING', 'this caller is not the owner');
  const [[row]] = await pool.query("SELECT type, amount, status, source, reason FROM employee_bonuses WHERE tenant_id=? AND staff_id='sa-mona'", [T]);
  assert.deepEqual([row.type, Number(row.amount), row.source], ['deduction', 450, 'MANAGER_PENALTY']);
  assert.match(row.reason, /تأخير متكرر \(1\.5 يوم\)/);
  const self = await call(compensationRouter, 'post', '/api/admin/hr/month-penalties', { body: { staffId: 'sa-hr', month: 10, year: 2026, amount: 10, reason: 'x' } });
  assert.equal(self.statusCode, 409, 'nobody penalises themselves');
});

test('an absence «من الرصيد» costs nothing and spends a day of the 21; with none left it is refused', { skip }, async () => {
  const day = date => call(attendanceRouter, 'post', '/api/admin/hr/attendance', { body: { staff_id: 'sa-mona', date, status: 'LEAVE_BALANCE' } });
  const first = await day('2026-10-05');
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const [[logged]] = await pool.query("SELECT status, permit_used, deduction_days FROM attendance_logs WHERE tenant_id=? AND staff_id='sa-mona' AND date='2026-10-05'", [T]);
  assert.deepEqual([logged.status, logged.permit_used, Number(logged.deduction_days)], ['HOLIDAY', 'leave_balance', 0]);
  const excused = await call(attendanceRouter, 'post', '/api/admin/hr/attendance', { body: { staff_id: 'sa-mona', date: '2026-10-06', status: 'ABSENT_EXCUSED' } });
  assert.equal(excused.statusCode, 200);
  const [[kind]] = await pool.query("SELECT status, permit_used FROM attendance_logs WHERE tenant_id=? AND staff_id='sa-mona' AND date='2026-10-06'", [T]);
  assert.deepEqual([kind.status, kind.permit_used], ['ABSENT', 'excused'], 'an absence with permission still costs the day');
  // The other 20 days of the balance.
  for (let d = 1; d <= 20; d += 1) {
    await pool.query("INSERT INTO attendance_logs (id, tenant_id, staff_id, date, status, permit_used, source) VALUES (UUID(), ?, 'sa-mona', ?, 'HOLIDAY', 'free_day', 'MANUAL_ENTRY')",
      [T, `2026-0${1 + Math.floor((d - 1) / 5)}-${String(1 + ((d - 1) % 5)).padStart(2, '0')}`]);
  }
  const refused = await day('2026-10-07');
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'LEAVE_BALANCE_EMPTY');
  const resaved = await day('2026-10-05');
  assert.equal(resaved.statusCode, 200, 'the day already taken from the balance can be saved again');
});
