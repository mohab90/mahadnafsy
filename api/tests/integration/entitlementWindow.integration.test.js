'use strict';
/**
 * How long a course is open and what a re-grant may do to it, on a real MariaDB (these were regular expressions over lib/entitlements.js — `DEFAULT_ACCESS_MONTHS = 12`,
 * the `access_months` lookups for the course and the track, `expiry_date=CASE … GREATEST(…)`; the lecture-by-lecture access is in learningAccess): a course is open for the months it
 * names, else a year, counted from the subscription day, and a track that names its own window gives it to its courses; paying the next instalment leaves a live window where it was,
 * never shortens one an administrator extended, never closes an open-ended one, and starts again from today for a lapsed or revoked one; a grant that follows money never takes
 * back access already given, while an administrator's decision can; and only a real change is written to the history. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-window-it';
let pool; let grant;

const months = (from, count) => { const d = new Date(`${from}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + count); return d.toISOString().slice(0, 10); };
const day = value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10));
const enrollment = async (sub, course) => (await pool.query('SELECT status, access_type, lecture_limit, enrolled_at, expiry_date FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND course_id=?', [T, sub, course]))[0][0];
const events = async (sub, course) => (await pool.query("SELECT id FROM entitlement_events WHERE tenant_id=? AND subscriber_id=? AND course_id=? AND event_type='granted'", [T, sub, course]))[0].length;
const give = (sub, course, extra = {}) => grant({ tenantId: T, subscriberId: sub, courseId: course, source: 'manual_payment', ...extra });

async function clean() {
  for (const table of ['entitlement_events', 'enrollments', 'course_lectures', 'bundles', 'courses', 'subscribers']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ grantCourseEntitlement: grant } = require('../../lib/entitlements'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  const course = (id, monthsOpen) => pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp, access_months)
     VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', 1000, ?)`, [id, T, id, monthsOpen]);
  await course('co-wn-default', null); await course('co-wn-six', 6); await course('co-wn-track', null);
  await pool.query("INSERT INTO bundles (id, tenant_id, title, description, price_egp, access_months, is_published) VALUES ('bu-wn-18', ?, 'مسار', '', 4000, 18, 1)", [T]);
  for (let i = 1; i <= 6; i += 1) {
    await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES (?, ?, 'عميل', ?, 'ONLINE_EGYPT', 'branch-online-egypt')", [`sub-wn-${i}`, T, `101950000${i}`]);
  }
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a course is open for the months it names, else a year, from the subscription day; a track\'s own window goes to its courses', { skip }, async () => {
  await give('sub-wn-1', 'co-wn-default', { enrolledAt: '2026-03-10 09:00:00' });
  assert.equal(day((await enrollment('sub-wn-1', 'co-wn-default')).expiry_date), '2027-03-10', 'a year from the day the client subscribed');
  await give('sub-wn-1', 'co-wn-six', { enrolledAt: '2026-03-10 09:00:00' });
  assert.equal(day((await enrollment('sub-wn-1', 'co-wn-six')).expiry_date), '2026-09-10', 'the six months the course names');
  await give('sub-wn-1', 'co-wn-track', { enrolledAt: '2026-03-10 09:00:00', bundleId: 'bu-wn-18' });
  assert.equal(day((await enrollment('sub-wn-1', 'co-wn-track')).expiry_date), '2027-09-10', 'a year and a half, as the track says');
  const today = new Date().toISOString().slice(0, 10);
  await give('sub-wn-2', 'co-wn-default');
  assert.ok(Math.abs(new Date(day((await enrollment('sub-wn-2', 'co-wn-default')).expiry_date)) - new Date(months(today, 12))) <= 86400000 * 2, 'with no date given, a year from today');
});

test('the next instalment leaves a live window where it was, never shortens an extended one, never closes an open-ended one, and a lapsed one starts again', { skip }, async () => {
  await give('sub-wn-3', 'co-wn-default', { enrolledAt: '2026-06-01 09:00:00' });
  const first = day((await enrollment('sub-wn-3', 'co-wn-default')).expiry_date);
  await pool.query("UPDATE enrollments SET expiry_date='2099-01-01' WHERE tenant_id=? AND subscriber_id='sub-wn-3'", [T]);
  await give('sub-wn-3', 'co-wn-default', { enrolledAt: '2026-06-01 09:00:00' });
  assert.equal(day((await enrollment('sub-wn-3', 'co-wn-default')).expiry_date), '2099-01-01', 'an administrator\'s extension is never shortened');
  assert.equal(first, '2027-06-01');

  await give('sub-wn-4', 'co-wn-default', { enrolledAt: '2026-06-01 09:00:00' });
  await pool.query("UPDATE enrollments SET expiry_date=NULL WHERE tenant_id=? AND subscriber_id='sub-wn-4'", [T]);
  await give('sub-wn-4', 'co-wn-default');
  assert.equal((await enrollment('sub-wn-4', 'co-wn-default')).expiry_date, null, 'an open-ended one is not closed by paying an instalment');

  await give('sub-wn-5', 'co-wn-default', { enrolledAt: '2020-01-01 09:00:00' });
  assert.equal(day((await enrollment('sub-wn-5', 'co-wn-default')).expiry_date), '2021-01-01', 'a window from long ago has run out');
  await give('sub-wn-5', 'co-wn-default');
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(new Date(day((await enrollment('sub-wn-5', 'co-wn-default')).expiry_date)) > new Date(today), 'granted again, it starts again from today');
});

test('a grant that follows money never takes back what was given; an administrator\'s decision can; only a real change is written to the history', { skip }, async () => {
  await give('sub-wn-6', 'co-wn-default');
  assert.equal(await events('sub-wn-6', 'co-wn-default'), 1);
  await give('sub-wn-6', 'co-wn-default');
  assert.equal(await events('sub-wn-6', 'co-wn-default'), 1, 'the same grant again writes nothing');
  await give('sub-wn-6', 'co-wn-default', { accessType: 'limited', lectureLimit: 2 });
  assert.equal((await enrollment('sub-wn-6', 'co-wn-default')).access_type, 'full', 'a later payment row cannot lock a paid-up client out');

  await give('sub-wn-6', 'co-wn-default', { source: 'admin', accessType: 'limited', lectureLimit: 3 });
  const limited = await enrollment('sub-wn-6', 'co-wn-default');
  assert.deepEqual([limited.access_type, Number(limited.lecture_limit)], ['limited', 3], 'an administrator can limit it');
  await give('sub-wn-6', 'co-wn-default', { accessType: 'limited', lectureLimit: 1 });
  assert.equal(Number((await enrollment('sub-wn-6', 'co-wn-default')).lecture_limit), 3, 'a recomputation never lowers a held limit');
  await give('sub-wn-6', 'co-wn-default', { accessType: 'limited', lectureLimit: 5 });
  assert.equal(Number((await enrollment('sub-wn-6', 'co-wn-default')).lecture_limit), 5, 'but may raise it as instalments come in');
  assert.ok(await events('sub-wn-6', 'co-wn-default') >= 3);
});
