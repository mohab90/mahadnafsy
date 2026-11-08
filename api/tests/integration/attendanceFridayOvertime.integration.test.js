'use strict';
/**
 * 8–9 Nov 2026, HR finished: a month's fingerprint sheet uploaded again leaves every day entered by hand as it is, replaces a night's automatic
 * absence with what the device recorded, judges Saturday as the working day it is, and makes a Friday worked overtime; the month's screen shows
 * every Friday nobody worked as «إجازة أسبوعية»; HR can set a Friday as overtime at 1, 1.5, 2 … days. Real MariaDB over HTTP; runs only with DB_*.
 *
 *   employee A (device 9101): punches Thu 1st, Sat 3rd, Mon 5th, Fri 23rd. The 4th was entered by hand (from the leave balance) and stays;
 *                             the 5th had an automatic absence and becomes present.
 *   employee B (device 9102): no punch all month — absent on every working day, Saturdays included.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, ensureTenant } = require('./support/http');

const T = 'tenant-friday-it';
let pool; let app; let admin;

const punch = (bioNo, date, time) => ({ bioNo, date, time });
const PUNCHES = [
  ...['2026-10-01', '2026-10-03', '2026-10-05'].flatMap(date => [punch('9101', date, '10:58'), punch('9101', date, '18:33')]),
  punch('9101', '2026-10-23', '12:10'), punch('9101', '2026-10-23', '17:05'),
];
const rowOf = async (staffId, date) => (await pool.query(
  "SELECT status, source, permit_used, overtime_days FROM attendance_logs WHERE tenant_id=? AND staff_id=? AND date=?", [T, staffId, date]))[0][0] || null;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await ensureTenant(pool, T);
  app = await startApp(pool);
  admin = await signInStaff(pool, app, { tenantId: T, id: 'st-fr-admin', role: 'ADMIN', name: 'المدير' });
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, biometric_user_no, base_salary) VALUES
       ('st-fr-a', ?, 'موظفة أ', 'fr-a@x.t', '1017700001', 'SALES', 1, '2025-01-01', '9101', 6000),
       ('st-fr-b', ?, 'موظفة ب', 'fr-b@x.t', '1017700002', 'SALES', 1, '2025-01-01', '9102', 6000)`, [T, T]);
  await pool.query(
    `INSERT INTO hr_policy_versions (id, tenant_id, version, weekend_days_json, effective_from, free_day_per_month, weekend_overtime_days)
     VALUES ('pol-fr-1', ?, 1, '[5]', '2020-01-01', 0, 1)`, [T]);
  await pool.query(
    `INSERT INTO attendance_logs (id, tenant_id, staff_id, date, status, permit_used, notes, source) VALUES
       ('al-fr-1', ?, 'st-fr-a', '2026-10-04', 'HOLIDAY', 'leave_balance', 'اجازة باذن', 'MANUAL_ENTRY'),
       ('al-fr-2', ?, 'st-fr-a', '2026-10-05', 'ABSENT', NULL, 'غياب تلقائي — لم يُسجَّل حضور ولا إجازة', 'AUTO_ABSENCE')`, [T, T]);
  const { importAttendanceMonth } = require('../../lib/attendanceImport');
  await importAttendanceMonth(pool, { tenantId: T, month: '2026-10', punches: PUNCHES, today: '2026-11-09' });
});

after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('a day entered by hand is kept; a night\'s automatic absence is replaced by the punches', { skip }, async () => {
  assert.deepEqual(await rowOf('st-fr-a', '2026-10-04'), { status: 'HOLIDAY', source: 'MANUAL_ENTRY', permit_used: 'leave_balance', overtime_days: null });
  const fifth = await rowOf('st-fr-a', '2026-10-05');
  assert.deepEqual([fifth.status, fifth.source], ['PRESENT', 'FINGERPRINT_IMPORT']);
});

test('Saturday is judged as a working day: present when punched, absent when not', { skip }, async () => {
  assert.equal((await rowOf('st-fr-a', '2026-10-03')).status, 'PRESENT');
  assert.equal((await rowOf('st-fr-b', '2026-10-03')).status, 'ABSENT');
  assert.equal((await rowOf('st-fr-b', '2026-10-31')).status, 'ABSENT');
});

test('a Friday worked is overtime at the policy\'s day; a Friday not worked has no row', { skip }, async () => {
  const friday = await rowOf('st-fr-a', '2026-10-23');
  assert.deepEqual([friday.status, Number(friday.overtime_days)], ['PRESENT', 1]);
  assert.equal(await rowOf('st-fr-a', '2026-10-02'), null);
  assert.equal(await rowOf('st-fr-b', '2026-10-23'), null, 'nobody is absent on a Friday');
});

test('the month\'s screen shows every Friday nobody worked as a weekly day off, and the one worked as itself', { skip }, async () => {
  const res = await app.call('GET', '/api/admin/hr/attendance/st-fr-a?month=10&year=2026', { session: admin });
  assert.equal(res.status, 200, res.text);
  const fridays = res.body.filter(row => new Date(`${String(row.date).slice(0, 10)}T12:00:00Z`).getUTCDay() === 5);
  assert.deepEqual(fridays.map(row => [String(row.date).slice(0, 10), row.status, row.id === null]),
    [['2026-10-02', 'WEEKLY_OFF', true], ['2026-10-09', 'WEEKLY_OFF', true], ['2026-10-16', 'WEEKLY_OFF', true], ['2026-10-23', 'PRESENT', false], ['2026-10-30', 'WEEKLY_OFF', true]]);
  const days = res.body.map(row => String(row.date).slice(0, 10));
  assert.deepEqual(days, [...days].sort(), 'in date order');
});

test('HR sets a Friday as overtime at a day and a half; an overtime outside 0–5 days is refused', { skip }, async () => {
  const saved = await app.call('POST', '/api/admin/hr/attendance', { session: admin, body: { staff_id: 'st-fr-b', date: '2026-10-30', status: 'OVERTIME', check_in: '12:00', check_out: '16:00', overtime_days: 1.5 } });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(await rowOf('st-fr-b', '2026-10-30'), { status: 'PRESENT', source: 'MANUAL_ENTRY', permit_used: null, overtime_days: '1.50' });
  const bad = await app.call('POST', '/api/admin/hr/attendance', { session: admin, body: { staff_id: 'st-fr-b', date: '2026-10-16', status: 'OVERTIME', overtime_days: 9 } });
  assert.equal(bad.status, 400);
});

test('the month\'s summary carries the overtime days, for the month sheet and payroll', { skip }, async () => {
  const res = await app.call('GET', '/api/admin/hr/attendance/summary?month=10&year=2026', { session: admin });
  assert.equal(res.status, 200, res.text);
  const rows = Array.isArray(res.body) ? res.body : res.body.rows || res.body.staff || [];
  const of = id => rows.find(row => row.id === id);
  assert.equal(Number(of('st-fr-a').overtime_days), 1);
  assert.equal(Number(of('st-fr-b').overtime_days), 1.5);
});
