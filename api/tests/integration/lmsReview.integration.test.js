'use strict';
/**
 * The LMS review's findings, run against a real MariaDB:
 *   - a limited enrolment opens only its first lectures, even when lectures
 *     share an order number (the lecture form starts every one at 1)
 *   - the free lecture the server hands out is the first one the page lists:
 *     chapter first, then order, then id
 *   - the certificate sweep reads to the end, not the first 500, and issues
 *     the certificate the client sees; a required quiz not passed holds it
 *   - a certificate revoked by a refund comes back when the course is earned again
 *   - watched time grows only as fast as time passes
 *   - ten quiz attempts sent at once are counted one after another
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-lms-review-it';
let pool;

async function clean() {
  await pool.query("DELETE FROM course_lectures WHERE course_id IN ('lr-c1','lr-c2','lr-c3')").catch(() => {});
  await pool.query("DELETE FROM course_chapters WHERE course_id IN ('lr-c1','lr-c2','lr-c3')").catch(() => {});
  for (const table of ['certificate_events', 'message_outbox', 'notifications', 'quiz_attempts', 'course_quizzes', 'lecture_completions',
    'course_completions', 'payments', 'enrollments', 'subscribers', 'courses']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const lecture = (id, course, chapter, order, extra = {}) => pool.query(
  `INSERT INTO course_lectures (id, course_id, chapter_id, title, lecture_type, video_url, sort_order, is_published, duration_seconds, is_preview)
   VALUES (?,?,?,?, 'RECORDED', ?, ?, 1, ?, ?)`,
  [id, course, chapter, id, `https://youtu.be/${id}`, order, extra.duration ?? 600, extra.preview ? 1 : 0]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published) VALUES
       ('lr-c1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 1000, 1),
       ('lr-c2', ?, 'كورس ٢', '', '', '', '', 'GENERAL', 'RECORDED', 1000, 1),
       ('lr-c3', ?, 'كورس ٣', '', '', '', '', 'GENERAL', 'RECORDED', 1000, 1)`, [T, T, T]);
  await pool.query(
    `INSERT INTO course_chapters (id, course_id, title, sort_order) VALUES
       ('lr-ch-a', 'lr-c2', 'الأول', 1), ('lr-ch-b', 'lr-c2', 'التاني', 2)`);
  // Course 1: five lectures, every one at order 1, as the form leaves them.
  for (const id of ['lr-l1', 'lr-l2', 'lr-l3', 'lr-l4', 'lr-l5']) await lecture(id, 'lr-c1', null, 1);
  // Course 2: the first chapter's lecture has the higher order number.
  await lecture('lr-a1', 'lr-c2', 'lr-ch-a', 2);
  await lecture('lr-b1', 'lr-c2', 'lr-ch-b', 1);
  // Course 3: two lectures, a required quiz.
  await lecture('lr-x1', 'lr-c3', null, 1); await lecture('lr-x2', 'lr-c3', null, 2);
  await pool.query(
    `INSERT INTO course_quizzes (id, tenant_id, course_id, title, questions_json, passing_score, required_for_completion)
     VALUES ('lr-q', ?, 'lr-c3', 'اختبار', ?, 50, 1)`,
    [T, JSON.stringify([{ question: 'س', options: ['أ', 'ب'], correctIndex: 1 }])]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, firebase_uid) VALUES
       ('lr-s1', ?, 'منى', '1018000001', 'uid-lr-s1'), ('lr-s2', ?, 'سارة', '1018000002', 'uid-lr-s2')`, [T, T]);
  await pool.query(
    `INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, status, access_type, lecture_limit, enrolled_at) VALUES
       ('lr-e1', ?, 'lr-s1', 'lr-c1', 'active', 'limited', 1, NOW()),
       ('lr-e3', ?, 'lr-s2', 'lr-c3', 'active', 'full', NULL, NOW())`, [T, T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('a one-lecture enrolment opens one lecture, however the orders tie', { skip }, async () => {
  const { resolveLectureAccess } = require('../../lib/learningAccess');
  const open = [];
  for (const id of ['lr-l1', 'lr-l2', 'lr-l3', 'lr-l4', 'lr-l5']) {
    const access = await resolveLectureAccess({ tenantId: T, subscriberId: 'lr-s1', lectureId: id });
    if (access.accessible) open.push(id);
  }
  assert.deepEqual(open, ['lr-l1'], 'the first by id, and only it');
});

test('the free lecture is the first the page lists: chapter, then order', { skip }, async () => {
  const router = require('../../routes/public');
  const layer = router.stack.find(l => l.route?.path === '/api/courses/:id' && l.route.methods.get);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await layer.route.stack.at(-1).handle({ params: { id: 'lr-c2' }, query: {}, headers: {}, tenantId: T, get: () => undefined }, res);
  const lectures = res.body.lectures || res.body.course?.lectures || [];
  const byId = Object.fromEntries(lectures.map(l => [l.id, l]));
  assert.ok(byId['lr-a1'].videoUrl, 'the first chapter\'s lecture is the free one');
  assert.equal(byId['lr-b1'].videoUrl, '', 'the later chapter\'s is not');
});

test('the sweep holds a certificate for a required quiz, issues it once passed, and the client sees it', { skip }, async () => {
  const { runAutoCertificateSweep } = require('../../lib/autoCertificate');
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, status, date) VALUES ('lr-p3', ?, 'lr-s2', 'lr-c3', 1000, 1000, 'EGP', 'paid', CURDATE())", [T]);
  await pool.query(
    `INSERT INTO lecture_completions (id, tenant_id, subscriber_id, lecture_id, course_id, progress_pct, watch_seconds, completed_at)
     VALUES (UUID(), ?, 'lr-s2', 'lr-x1', 'lr-c3', 100, 600, NOW())`, [T]);
  assert.equal(await runAutoCertificateSweep(T), 0, 'half watched and paid, but the quiz is not passed');
  await pool.query(
    `INSERT INTO quiz_attempts (id, tenant_id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at)
     VALUES (UUID(), ?, 'lr-s2', 'lr-q', 'lr-c3', 100, 1, '[1]', NOW())`, [T]);
  assert.equal(await runAutoCertificateSweep(T), 1);
  const [[completion]] = await pool.query("SELECT status FROM course_completions WHERE tenant_id=? AND subscriber_id='lr-s2' AND course_id='lr-c3'", [T]);
  assert.equal(completion.status, 'active', 'the certificate the client\'s page reads');
  assert.equal(await runAutoCertificateSweep(T), 0, 'once');
});

test('the sweep reads past the first five hundred', { skip }, async () => {
  const { runAutoCertificateSweep } = require('../../lib/autoCertificate');
  const subs = []; const enrolments = []; const watched = [];
  for (let i = 0; i < 520; i++) {
    const id = `lr-bulk-${String(i).padStart(4, '0')}`;
    subs.push([id, T, id, `10190${String(i).padStart(5, '0')}`]);
    enrolments.push([`lr-be-${String(i).padStart(4, '0')}`, T, id, 'lr-c3', 'active', 'full', new Date()]);
    watched.push([`lr-bw-${i}`, T, id, 'lr-x1', 'lr-c3', 10, 10]);
  }
  await pool.query('INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ?', [subs]);
  await pool.query('INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, status, access_type, enrolled_at) VALUES ?', [enrolments]);
  await pool.query('INSERT INTO lecture_completions (id, tenant_id, subscriber_id, lecture_id, course_id, progress_pct, watch_seconds) VALUES ?', [watched]);
  // Only the last one, past the first batch, earns it.
  const last = 'lr-bulk-0519';
  await pool.query("UPDATE lecture_completions SET progress_pct=100 WHERE tenant_id=? AND subscriber_id=?", [T, last]);
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, status, date) VALUES ('lr-pb', ?, ?, 'lr-c3', 1000, 1000, 'EGP', 'paid', CURDATE())", [T, last]);
  await pool.query("INSERT INTO quiz_attempts (id, tenant_id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at) VALUES (UUID(), ?, ?, 'lr-q', 'lr-c3', 100, 1, '[1]', NOW())", [T, last]);
  assert.equal(await runAutoCertificateSweep(T), 1);
});

test('a certificate revoked by a refund comes back when the course is earned again', { skip }, async () => {
  const { completeCourse } = require('../../lib/courseCompletion');
  const { revokeCertificate } = require('../../lib/certificateLifecycle');
  const [[completion]] = await pool.query("SELECT id, certificate_code FROM course_completions WHERE tenant_id=? AND subscriber_id='lr-s2'", [T]);
  await revokeCertificate({ tenantId: T, completionId: completion.id, actor: 'refund', reason: 'refund' });
  const again = await completeCourse({ tenantId: T, subscriberId: 'lr-s2', courseId: 'lr-c3', actor: 'test', requireFullProgress: false });
  assert.equal(again.alreadyCompleted, false);
  const [[after]] = await pool.query('SELECT status, certificate_code FROM course_completions WHERE id=?', [completion.id]);
  assert.equal(after.status, 'active');
  assert.notEqual(after.certificate_code, completion.certificate_code, 'a fresh code, the old one stays revoked in the log');
});

test('watched time grows only as fast as time passes', { skip }, async () => {
  const { recordLectureProgress, FIRST_SAVE_SECONDS } = require('../../lib/learningProgress');
  await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, status, access_type, enrolled_at) VALUES ('lr-e2', ?, 'lr-s1', 'lr-c2', 'active', 'full', NOW())", [T]);
  // Straight to the end of a ten-minute lecture.
  const jump = await recordLectureProgress({ tenantId: T, subscriberId: 'lr-s1', lectureId: 'lr-a1', progress: 100, watchSeconds: 600 });
  assert.equal(jump.watchSeconds, FIRST_SAVE_SECONDS);
  assert.ok(jump.progress < 100, 'not finished by one request');
  // Ten minutes later, by the clock, the same report is believed.
  await pool.query("UPDATE lecture_completions SET progress_saved_at = NOW() - INTERVAL 10 MINUTE WHERE tenant_id=? AND lecture_id='lr-a1'", [T]);
  const watched = await recordLectureProgress({ tenantId: T, subscriberId: 'lr-s1', lectureId: 'lr-a1', progress: 100, watchSeconds: 600 });
  assert.equal(watched.progress, 100);
});

test('ten quiz attempts sent at once are counted one after another', { skip }, async () => {
  const router = require('../../routes/public');
  const handle = router.stack.find(l => l.route?.path === '/api/me/quiz-attempts' && l.route.methods.post).route.stack.at(-1).handle;
  await pool.query('DELETE FROM quiz_attempts WHERE tenant_id=?', [T]);
  const send = () => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
    return handle({ body: { quizId: 'lr-q', answers: [0] }, query: {}, params: {}, headers: {}, tenantId: T,
      user: { uid: 'uid-lr-s2', email: null }, get: () => undefined }, res).then(() => res);
  };
  const results = await Promise.all(Array.from({ length: 14 }, send));
  assert.equal(results.filter(r => r.statusCode === 200).length, 10, results.map(r => r.statusCode).join(','));
  assert.equal(results.filter(r => r.statusCode === 429).length, 4);
  const [[count]] = await pool.query("SELECT COUNT(*) AS n FROM quiz_attempts WHERE tenant_id=? AND quiz_id='lr-q'", [T]);
  assert.equal(Number(count.n), 10);
});
