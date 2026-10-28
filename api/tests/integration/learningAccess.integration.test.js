'use strict';
/**
 * Who may watch which lecture, against a real MariaDB.
 *
 * lib/learningAccess.js answers each enrolment kind as itself — full, limited
 * by the lecture's place in the course, a «غير مفعل» grant that opens nothing,
 * expired, drip-locked, revoked, an archived customer, a deleted course, an
 * unpublished lecture. The media address re-checks the enrolment behind its
 * ticket. The public catalogue gives away the first lecture by position (ties
 * broken, not counted twice) and an explicit preview, and nothing else.
 * lib/entitlements.js opens lectures in proportion to what was paid, never
 * takes back what a payment opened, and records every grant. The desk closes a
 * course with a reason and reopens it to what it was; archiving a customer
 * signs their login out of everything, and restoring gives it back. Replaces
 * the source-text checks on these files. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, signInCustomer, ensureTenant } = require('./support/http');

const T = 'tenant-lms-it';
const C = 'co-lms-1';
let pool; let app; let admin; let resolveLectureAccess; let entitlements;

const one = async (sql, params) => (await pool.query(sql, params))[0][0];
const access = (subscriberId, lectureId) => resolveLectureAccess({ tenantId: T, subscriberId, lectureId });

async function enrol(subscriberId, course, fields = {}) {
  const row = { access_type: 'full', lecture_limit: null, status: 'active', expiry_date: null, enrolled_at: null, ...fields };
  await pool.query(
    `INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, access_type, lecture_limit, status, expiry_date, entitlement_source)
     VALUES (?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()), ?, ?, ?, ?, 'manual')`,
    [`en-${subscriberId}-${course}`, T, subscriberId, course, row.enrolled_at, row.access_type, row.lecture_limit, row.status, row.expiry_date]);
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ resolveLectureAccess } = require('../../lib/learningAccess'));
  entitlements = require('../../lib/entitlements');
  await ensureTenant(pool, T);
  for (const [id, deleted] of [[C, null], ['co-lms-gone', 'deleted'], ['co-lms-ratio', null]]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published, deleted_at)
       VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', 1000, 1, ?)`, [id, T, id, deleted ? new Date() : null]);
  }
  await pool.query("INSERT INTO course_chapters (id, course_id, title, sort_order) VALUES ('ch-lms-1', ?, 'الأول', 1), ('ch-lms-2', ?, 'الثاني', 2)", [C, C]);
  // Chapter two is listed first in the table, and lectures share sort_order 1:
  // the course's order is chapter, then lecture order, then id.
  const lectures = [
    ['lec-b', 'ch-lms-2', 1, 1, 0, 0], ['lec-a1', 'ch-lms-1', 1, 1, 0, 0], ['lec-a2', 'ch-lms-1', 1, 1, 0, 0],
    ['lec-a3', 'ch-lms-1', 2, 1, 0, 30], ['lec-hidden', 'ch-lms-1', 3, 0, 0, 0], ['lec-preview', 'ch-lms-2', 9, 1, 1, 0],
  ];
  for (const [id, chapter, sort, published, preview, drip] of lectures) {
    await pool.query(
      `INSERT INTO course_lectures (id, course_id, chapter_id, title, lecture_type, video_url, sort_order, is_published, is_preview, drip_unlock_days)
       VALUES (?, ?, ?, ?, 'RECORDED', ?, ?, ?, ?, ?)`,
      [id, C, chapter, id, `https://www.youtube.com/watch?v=${id}`, sort, published, preview, drip]);
  }
  await pool.query(
    `INSERT INTO course_lectures (id, course_id, title, lecture_type, video_url, sort_order, is_published)
     VALUES ('lec-gone', 'co-lms-gone', 'x', 'RECORDED', 'https://www.youtube.com/watch?v=gone', 1, 1)`);
  for (const id of ['lec-r1', 'lec-r2', 'lec-r3', 'lec-r4']) {
    await pool.query(
      `INSERT INTO course_lectures (id, course_id, title, lecture_type, video_url, sort_order, is_published)
       VALUES (?, 'co-lms-ratio', ?, 'RECORDED', 'https://www.youtube.com/watch?v=r', ?, 1)`, [id, id, Number(id.slice(-1))]);
  }
  const subscribers = ['s-full', 's-limited', 's-preview', 's-expired', 's-revoked', 's-archived', 's-none', 's-ratio', 's-desk'];
  for (const id of subscribers) {
    await pool.query(
      `INSERT INTO subscribers (id, tenant_id, name, phone, email, is_active, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(), ?)`,
      [id, T, id, `0105550${String(subscribers.indexOf(id)).padStart(4, '0')}`, `${id}@example.test`, id === 's-archived' ? new Date() : null]);
  }
  await enrol('s-full', C);
  await enrol('s-full', 'co-lms-gone');
  await enrol('s-limited', C, { access_type: 'limited', lecture_limit: 1 });
  await enrol('s-preview', C, { access_type: 'preview' });
  await enrol('s-expired', C, { expiry_date: '2020-01-01 00:00:00' });
  await enrol('s-revoked', C, { status: 'revoked' });
  await enrol('s-archived', C);
  await enrol('s-desk', C, { access_type: 'limited', lecture_limit: 2 });
  app = await startApp(pool);
  admin = await signInStaff(pool, app, { tenantId: T, id: 'st-lms-admin', role: 'ADMIN' });
});

after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('a full enrolment opens every published lecture, and only published ones', { skip }, async () => {
  for (const id of ['lec-a1', 'lec-a2', 'lec-b', 'lec-preview']) assert.equal((await access('s-full', id)).accessible, true, id);
  assert.equal((await access('s-full', 'lec-hidden')).reason, 'not_found');
});

test('a deleted course, a revoked enrolment, an archived customer and no enrolment open nothing', { skip }, async () => {
  assert.equal((await access('s-full', 'lec-gone')).reason, 'not_found');
  assert.equal((await access('s-revoked', 'lec-a1')).reason, 'not_enrolled');
  assert.equal((await access('s-archived', 'lec-a1')).reason, 'not_enrolled', 'an archived customer keeps no lecture');
  assert.equal((await access('s-none', 'lec-a1')).reason, 'not_enrolled');
});

test('expiry and drip are enforced', { skip }, async () => {
  assert.equal((await access('s-expired', 'lec-a1')).reason, 'access_expired');
  const drip = await access('s-full', 'lec-a3');
  assert.equal(drip.reason, 'drip_locked');
  assert.ok(drip.unlocksAt);
});

test('only full and limited open anything: a «غير مفعل» grant is refused by name', { skip }, async () => {
  const res = await access('s-preview', 'lec-a1');
  assert.equal(res.accessible, false);
  assert.equal(res.reason, 'not_activated');
});

test('a limited enrolment is measured by the lecture\'s place in the course, ties broken by id', { skip }, async () => {
  // Order: lec-a1, lec-a2 (chapter 1, sort 1, by id), lec-a3, then chapter 2.
  assert.equal((await access('s-limited', 'lec-a1')).accessible, true);
  const second = await access('s-limited', 'lec-a2');
  assert.equal(second.reason, 'access_limited', 'a lecture sharing the first one\'s order is still second');
  assert.equal(second.allowed, 1);
  assert.equal((await access('s-limited', 'lec-b')).reason, 'access_limited', 'a later chapter is later, whatever its table order');
});

test('the media address re-checks the enrolment behind its ticket', { skip }, async () => {
  const { createMediaTicket } = require('../../lib/mediaAccess');
  const ticket = createMediaTicket({ tenantId: T, subscriberId: 's-desk', lectureId: 'lec-a1', kind: 'embed' });
  const url = `/api/media/lectures/lec-a1?ticket=${encodeURIComponent(ticket)}&kind=embed`;
  const open = await fetch(`${app.base}${url}`, { headers: { 'X-Tenant-Id': T }, redirect: 'manual' });
  assert.equal(open.status, 302);
  assert.equal((await fetch(`${app.base}/api/media/lectures/lec-a1?ticket=forged`, { headers: { 'X-Tenant-Id': T }, redirect: 'manual' })).status, 401);
  await pool.query("UPDATE enrollments SET status='revoked' WHERE id='en-s-desk-co-lms-1'");
  try {
    const closed = await fetch(`${app.base}${url}`, { headers: { 'X-Tenant-Id': T }, redirect: 'manual' });
    assert.equal(closed.status, 404, 'a ticket issued before the course was closed opens nothing after');
  } finally {
    await pool.query("UPDATE enrollments SET status='active' WHERE id='en-s-desk-co-lms-1'");
  }
});

test('the public catalogue gives away the first lecture by position and an explicit preview, nothing more', { skip }, async () => {
  for (const path of [`/api/lectures?courseId=${C}`, `/api/courses/${C}`]) {
    const res = await app.call('GET', path, { tenantId: T });
    assert.equal(res.status, 200, res.text);
    const list = Array.isArray(res.body) ? res.body : res.body.lectures;
    const mine = list.filter(l => (l.courseId || l.course_id) === C);
    const free = mine.filter(l => l.videoUrl).map(l => l.id).sort();
    assert.deepEqual(free, ['lec-a1', 'lec-preview'], `${path}: first by place, plus the explicit preview`);
    assert.ok(!mine.some(l => l.id === 'lec-hidden'), `${path}: an unpublished lecture is not listed`);
  }
});

test('lectures open in proportion to what was paid, and an explicit number wins', { skip }, async () => {
  const grant = (fields) => entitlements.grantCourseEntitlement({
    tenantId: T, subscriberId: 's-ratio', courseId: 'co-lms-ratio', accessType: 'limited', source: 'manual_payment', actor: 'it', ...fields,
  });
  await grant({ paidRatio: 0.1 });
  let row = await one("SELECT access_type, lecture_limit, entitlement_source, granted_by FROM enrollments WHERE subscriber_id='s-ratio'");
  assert.equal(Number(row.lecture_limit), 1, 'any payment opens the first lecture');
  assert.equal(row.entitlement_source, 'manual_payment');
  assert.equal(row.granted_by, 'it');
  await grant({ paidRatio: 0.6 });
  row = await one("SELECT lecture_limit FROM enrollments WHERE subscriber_id='s-ratio'");
  assert.equal(Number(row.lecture_limit), 3, '60% of four published lectures, rounded up');
  await grant({ paidRatio: 0.3 });
  row = await one("SELECT lecture_limit FROM enrollments WHERE subscriber_id='s-ratio'");
  assert.equal(Number(row.lecture_limit), 3, 'a recomputation never takes back what a payment opened');
  await grant({ paidRatio: 0.3, lectureLimit: 1, source: 'admin' });
  row = await one("SELECT lecture_limit FROM enrollments WHERE subscriber_id='s-ratio'");
  assert.equal(Number(row.lecture_limit), 1, 'an administrator naming a number decides');
  await grant({ accessType: 'full' });
  await grant({ paidRatio: 0.2 });
  row = await one("SELECT access_type FROM enrollments WHERE subscriber_id='s-ratio'");
  assert.equal(row.access_type, 'full', 'a paid-up client is not locked back to limited by a later payment row');
  const events = await one("SELECT COUNT(*) AS n FROM entitlement_events WHERE tenant_id=? AND subscriber_id='s-ratio' AND event_type='granted'", [T]);
  assert.ok(Number(events.n) >= 4, 'every change of grant leaves an event');
});

test('the desk closes a course with a reason and reopens it to exactly what it was', { skip }, async () => {
  await pool.query(
    "INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, created_at) VALUES ('ld-lms-desk', ?, 's-desk', '01055500088', 'x', 'won', 0, UTC_TIMESTAMP())", [T]);
  await pool.query("UPDATE subscribers SET lead_id='ld-lms-desk', branch='ONLINE_EGYPT', branch_id='branch-online-egypt' WHERE id='s-desk'");
  // A Dokki desk does not reach an online client's courses.
  const dokki = await signInStaff(pool, app, { tenantId: T, id: 'st-lms-dokki', role: 'DAQQI_MANAGER', branchId: 'branch-daqqi' });
  const outside = await app.call('POST', '/api/admin/subscribers/s-desk/course-access', {
    session: dokki, body: { courseId: C, action: 'close', reason: 'محاولة' } });
  assert.ok([403, 404].includes(outside.status), outside.text);
  assert.equal((await one("SELECT status FROM enrollments WHERE id='en-s-desk-co-lms-1'")).status, 'active');

  const post = body => app.call('POST', '/api/admin/subscribers/s-desk/course-access', { session: admin, body: { courseId: C, ...body } });
  assert.equal((await post({ action: 'close' })).status, 400, 'a lock says what it is for');
  assert.equal((await post({ action: 'pause', reason: 'x' })).status, 400);
  const closed = await post({ action: 'close', reason: 'متأخر في الأقساط' });
  assert.equal(closed.status, 200, closed.text);
  assert.notEqual((await one("SELECT status FROM enrollments WHERE id='en-s-desk-co-lms-1'")).status, 'active');
  assert.equal((await access('s-desk', 'lec-a1')).accessible, false);
  const trail = await one("SELECT COUNT(*) AS n FROM lead_timeline WHERE tenant_id=? AND lead_id='ld-lms-desk'", [T]);
  assert.ok(Number(trail.n) >= 1, 'the lock is written into the client\'s record');
  const opened = await post({ action: 'open' });
  assert.equal(opened.status, 200, opened.text);
  const row = await one("SELECT status, access_type, lecture_limit FROM enrollments WHERE id='en-s-desk-co-lms-1'");
  assert.deepEqual({ ...row, lecture_limit: Number(row.lecture_limit) }, { status: 'active', access_type: 'limited', lecture_limit: 2 },
    'given back what was taken, not a recomputed share');
});

test('archiving a customer signs their login out of everything; restoring gives it back', { skip }, async () => {
  const customer = await signInCustomer(pool, app, { tenantId: T, id: 's-arch2', email: 'arch2@example.test', phone: '01055599999' });
  await enrol('s-arch2', C);
  // The login is found by its id even when the client's address has since changed.
  await pool.query("UPDATE subscribers SET email='changed.arch2@example.test' WHERE id='s-arch2'");
  assert.equal((await app.call('GET', '/api/me/subscriber', { session: customer })).status, 200);
  const archived = await app.call('DELETE', '/api/admin/subscribers/s-arch2', { session: admin });
  assert.equal(archived.status, 200, archived.text);
  assert.equal(Number((await one("SELECT is_active FROM users WHERE id='u-s-arch2'")).is_active), 0);
  assert.equal((await app.call('GET', '/api/me/subscriber', { session: customer })).status, 401, 'the session ends with it');
  assert.equal((await access('s-arch2', 'lec-a1')).accessible, false);
  const restored = await app.call('POST', '/api/admin/subscribers/s-arch2/restore', { session: admin, body: {} });
  assert.equal(restored.status, 200, restored.text);
  assert.equal(Number((await one("SELECT is_active FROM users WHERE id='u-s-arch2'")).is_active), 1);
  assert.equal(Number((await one("SELECT is_active FROM users WHERE id=?", [admin.userId])).is_active), 1,
    'a member of staff is never caught by the customer predicate');
});
