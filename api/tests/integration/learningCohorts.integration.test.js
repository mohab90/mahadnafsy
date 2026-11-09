'use strict';
/**
 * Course cohorts, on a real MariaDB (these were regular expressions over lib/learningCohorts.js — `has_paid_source`, `has_other_cohort`, `revokeCourseEntitlement({…})`, the cohort
 * `FOR UPDATE`): a cohort needs a title, a real course and an end after its start, and its course cannot change while it has members; only an active cohort takes members, up to its
 * capacity, and a member gets the course from it; taking a member out takes the course away only when the cohort was what gave it — never from a client who also paid for the
 * course or sits in another cohort of it; and cancelling a cohort removes everyone in it on the same terms. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-cohort-it';
let pool; let cohorts;

/** Runs `work` in one transaction, the way the routes do. */
async function inTx(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally { conn.release(); }
}
const save = (extra = {}) => inTx(db => cohorts.saveCohort({ tenantId: T, courseId: 'co-ch-1', title: 'دفعة نوفمبر', status: 'active', ...extra }, db));
const add = (cohortId, subscriberId) => inTx(db => cohorts.addCohortMember({ tenantId: T, cohortId, subscriberId }, db));
const remove = (cohortId, subscriberId) => inTx(db => cohorts.removeCohortMember({ tenantId: T, cohortId, subscriberId }, db));
const enrollment = async (sub, course = 'co-ch-1') => (await pool.query('SELECT status, entitlement_source FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND course_id=?', [T, sub, course]))[0][0];
const status = (error, code) => error && error.statusCode === code;

async function clean() {
  for (const table of ['entitlement_events', 'cohort_members', 'course_cohorts', 'enrollments', 'payments', 'subscribers', 'courses']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  cohorts = require('../../lib/learningCohorts');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  for (const id of ['co-ch-1', 'co-ch-2']) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
       VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', 1000)`, [id, T, id]);
  }
  for (let i = 1; i <= 5; i += 1) {
    await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES (?, ?, 'طالبة', ?, 'ONLINE_EGYPT', 'branch-online-egypt')", [`sub-ch-${i}`, T, `101960000${i}`]);
  }
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a cohort needs a title, a real course and an end after its start; the course of a cohort with members cannot change', { skip }, async () => {
  await assert.rejects(save({ title: ' ' }), error => status(error, 400));
  await assert.rejects(save({ status: 'nonsense' }), error => status(error, 400));
  await assert.rejects(save({ startsAt: '2026-12-10', endsAt: '2026-12-01' }), error => status(error, 400), 'the end after the start');
  await assert.rejects(save({ courseId: 'co-nope' }), error => status(error, 404));
  await assert.rejects(save({ id: 'ch-nope' }), error => status(error, 404));
  const id = await save({ maxStudents: 2 });
  await add(id, 'sub-ch-1');
  await assert.rejects(save({ id, courseId: 'co-ch-2', maxStudents: 2 }), error => status(error, 409), 'its course cannot change under its members');
  assert.equal((await cohorts.listCohorts(T)).find(item => item.id === id).memberCount, 1);
});

test('only an active cohort takes members, up to its capacity, and a member gets the course from it', { skip }, async () => {
  const [{ id }] = (await pool.query("SELECT id FROM course_cohorts WHERE tenant_id=? AND title='دفعة نوفمبر'", [T]))[0];
  const draft = await save({ title: 'مسودة', status: 'draft' });
  await assert.rejects(add(draft, 'sub-ch-2'), error => status(error, 404), 'a draft takes nobody');
  await assert.rejects(add(id, 'sub-nobody'), error => status(error, 404));
  assert.equal((await enrollment('sub-ch-1')).entitlement_source, `cohort:${id}`, 'the course came with the cohort');
  assert.deepEqual(await add(id, 'sub-ch-1'), { changed: false, courseId: 'co-ch-1' }, 'adding twice changes nothing');
  assert.equal((await add(id, 'sub-ch-2')).changed, true);
  await assert.rejects(add(id, 'sub-ch-3'), error => status(error, 409), 'two seats, two members');
});

test('taking a member out takes the course away only when the cohort gave it: not from one who also paid, nor one in another cohort of it', { skip }, async () => {
  const [{ id }] = (await pool.query("SELECT id FROM course_cohorts WHERE tenant_id=? AND title='دفعة نوفمبر'", [T]))[0];
  assert.deepEqual(await remove(id, 'sub-ch-1'), { changed: true });
  assert.equal((await enrollment('sub-ch-1')).status, 'revoked', 'the cohort was all they had');
  assert.deepEqual(await remove(id, 'sub-ch-1'), { changed: false }, 'removing twice changes nothing');

  // sub-ch-2 paid for the course as well
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, status, payment_type, date)
     VALUES ('p-ch-2', ?, 'sub-ch-2', 'co-ch-1', 1000, 1000, 'EGP', 'paid', 'COURSE', NOW())`, [T]);
  await remove(id, 'sub-ch-2');
  assert.equal((await enrollment('sub-ch-2')).status, 'active', 'a paid course stays after the cohort lets go');

  // sub-ch-3 is in two cohorts of the course
  const second = await save({ title: 'دفعة ديسمبر' });
  await pool.query("UPDATE course_cohorts SET max_students=NULL WHERE id IN (?, ?)", [id, second]);
  await add(id, 'sub-ch-3'); await add(second, 'sub-ch-3');
  await remove(id, 'sub-ch-3');
  assert.equal((await enrollment('sub-ch-3')).status, 'active', 'still in another cohort of the same course');
  await remove(second, 'sub-ch-3');
  assert.equal((await enrollment('sub-ch-3')).status, 'revoked', 'in none, and the cohort gave it: gone');
});

test('cancelling a cohort removes everyone in it on the same terms', { skip }, async () => {
  const id = await save({ title: 'تُلغى' });
  await add(id, 'sub-ch-4'); await add(id, 'sub-ch-5');
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, status, payment_type, date) VALUES ('p-ch-5', ?, 'sub-ch-5', 'co-ch-1', 1000, 1000, 'EGP', 'paid', 'COURSE', NOW())", [T]);
  await save({ id, title: 'تُلغى', status: 'cancelled' });
  assert.equal((await enrollment('sub-ch-4')).status, 'revoked', 'the one who had only the cohort loses the course');
  assert.equal((await enrollment('sub-ch-5')).status, 'active', 'the one who paid keeps it');
  assert.equal((await pool.query("SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id=? AND status='active'", [id]))[0][0].n, 0);
});
