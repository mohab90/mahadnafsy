'use strict';
/**
 * 5 Nov 2026: the quizzes work with their questions from end to end, against a real MariaDB. Staff save a quiz (a quiz with no questions, with three options, or with no valid
 * correct answer is refused), an enrolled student sees it WITHOUT its answers, and submits: the server grades against the saved questions, a wrong number of answers is
 * refused, a student who is not enrolled cannot take it nor see it, and the tenth attempt in a day is the last. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-quizzes-e2e-it';
let pool, catalogRouter, publicRouter;

const students = { enrolled: { id: 'qz-u1', email: 'qz-in@x.t' }, outsider: { id: 'qz-u2', email: 'qz-out@x.t' } };
const clean = async () => {
  for (const table of ['quiz_attempts', 'course_quizzes', 'enrollments', 'subscribers', 'users', 'courses']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
};
async function call(router, method, routePath, { user = null, body = {}, query = {} } = {}) {
  const layer = router.stack.find(entry => entry.route?.path === routePath && entry.route.methods[method]);
  const res = { statusCode: 200, body: undefined, headers: {}, set() { return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const req = { params: {}, query, body, headers: {}, tenantId: T, ip: '1', get: () => undefined, isSuperAdmin: true, user: { uid: user?.id || 'admin', email: user?.email || 'admin@x.t', session_id: 's' } };
  await layer.route.stack.at(-1).handle(req, res, () => {});
  return res;
}
const question = (text, correct) => ({ question: text, options: ['أ', 'ب', 'ج', 'د'], correctIndex: correct, explanation: 'شرح' });
const goodQuiz = () => ({ id: 'qz-q1', courseId: 'qz-c1', title: 'اختبار الوحدة الأولى', passingScore: 60, questions: [question('س١', 1), question('س٢', 3), question('س٣', 0)] });

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  catalogRouter = require('../../routes/core/catalog');
  publicRouter = require('../../routes/public');
  await clean();
  await pool.query(
    `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published)
     VALUES ('qz-c1', ?, 'qz-c1-it', 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 1000, 1)`, [T]);
  for (const [index, key] of Object.keys(students).entries()) {
    const user = students[key];
    await pool.query("INSERT INTO users (id, tenant_id, email, phone, name, password_hash) VALUES (?, ?, ?, ?, 'م', 'x')", [user.id, T, user.email, `10199000${index}1`]);
    await pool.query("INSERT INTO subscribers (id, tenant_id, firebase_uid, client_code, name, email, phone, branch) VALUES (?, ?, ?, ?, 'طالب', ?, ?, 'ONLINE_EGYPT')", [`qz-s${index}`, T, user.id, `QZ${index}`, user.email, `10199000${index}1`]);
  }
  await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, status) VALUES (UUID(), ?, 'qz-s0', 'qz-c1', NOW(), 'active')", [T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('staff save a quiz with its questions, and the questions are what is stored', { skip }, async () => {
  const res = await call(catalogRouter, 'post', '/api/admin/quizzes', { body: goodQuiz() });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [[row]] = await pool.query('SELECT questions_json, passing_score FROM course_quizzes WHERE id=? AND tenant_id=?', ['qz-q1', T]);
  const stored = JSON.parse(row.questions_json);
  assert.equal(stored.length, 3);
  assert.deepEqual(stored.map(item => item.correctIndex), [1, 3, 0]);
  assert.equal(Number(row.passing_score), 60);
});

test('a quiz that could not be taken is refused when it is saved: no questions, three options, no valid correct answer, an empty option', { skip }, async () => {
  const cases = {
    'no questions': { ...goodQuiz(), id: 'qz-bad', questions: [] },
    'three options': { ...goodQuiz(), id: 'qz-bad', questions: [{ ...question('س', 0), options: ['أ', 'ب', 'ج'] }] },
    'correct answer out of range': { ...goodQuiz(), id: 'qz-bad', questions: [question('س', 4)] },
    'an empty option': { ...goodQuiz(), id: 'qz-bad', questions: [{ ...question('س', 0), options: ['أ', '', 'ج', 'د'] }] },
    'no course': { ...goodQuiz(), id: 'qz-bad', courseId: null },
  };
  for (const [name, body] of Object.entries(cases)) assert.equal((await call(catalogRouter, 'post', '/api/admin/quizzes', { body })).statusCode, 400, name);
  assert.equal((await pool.query("SELECT COUNT(*) n FROM course_quizzes WHERE id='qz-bad' AND tenant_id=?", [T]))[0][0].n, 0, 'none of them was kept');
});

test('an enrolled student sees the quiz and its questions but never the answers; one who is not enrolled sees nothing', { skip }, async () => {
  const seen = (await call(publicRouter, 'get', '/api/quizzes', { user: students.enrolled })).body;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].questions.length, 3, 'the questions are there');
  const text = JSON.stringify(seen);
  assert.equal(/correctIndex|correct_index|explanation/.test(text), false, 'no answer key and no explanation is sent before the attempt');
  assert.deepEqual((await call(publicRouter, 'get', '/api/quizzes', { user: students.outsider })).body, []);
});

test('the server grades the attempt against the saved questions', { skip }, async () => {
  const submit = answers => call(publicRouter, 'post', '/api/me/quiz-attempts', { user: students.enrolled, body: { quizId: 'qz-q1', answers } });
  const started = Date.now();
  const perfect = await submit([1, 3, 0]);
  assert.equal(perfect.statusCode, 200, JSON.stringify(perfect.body));
  assert.deepEqual([perfect.body.score, perfect.body.passed], [100, true]);
  // A passing attempt finishes the course on a second connection. Run while the attempt's own connection still held the subscriber's row, each waited for the other
  // until the database gave up after 50 seconds and the attempt came back as an error. It is run after the commit now.
  assert.ok(Date.now() - started < 10_000, `a passing attempt answered in ${Date.now() - started} ms`);
  assert.equal(perfect.body.completionPending, true, 'passed, but the course is not finished yet (nothing watched): kept as pending, not an error');
  const partial = await submit([1, 0, 0]);       // 2 of 3 = 67%, the pass mark is 60
  assert.deepEqual([Math.round(partial.body.score), partial.body.passed], [67, true]);
  const failed = await submit([0, 0, 1]);         // 0 of 3
  assert.deepEqual([failed.body.score, failed.body.passed], [0, false]);
  assert.equal((await submit([1, 3])).statusCode, 400, 'a wrong number of answers');
  assert.equal((await submit([1, 3, 9])).statusCode, 400, 'an answer that is not an option');
});

test('a student who is not enrolled cannot take it, and the attempts are the student\'s own', { skip }, async () => {
  const res = await call(publicRouter, 'post', '/api/me/quiz-attempts', { user: students.outsider, body: { quizId: 'qz-q1', answers: [1, 3, 0] } });
  assert.equal(res.statusCode, 403);
  const mine = (await call(publicRouter, 'get', '/api/me/quiz-attempts', { user: students.enrolled })).body;
  assert.equal(mine.length >= 3, true);
  assert.deepEqual((await call(publicRouter, 'get', '/api/me/quiz-attempts', { user: students.outsider })).body, [], 'another student\'s attempts are not shown');
});

test('the tenth attempt within a day is the last: brute-forcing a quiz is stopped', { skip }, async () => {
  const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM quiz_attempts WHERE tenant_id=? AND quiz_id='qz-q1'", [T]);
  let last;
  for (let count = Number(n); count < 12; count++) last = await call(publicRouter, 'post', '/api/me/quiz-attempts', { user: students.enrolled, body: { quizId: 'qz-q1', answers: [0, 0, 0] } });
  assert.equal(last.statusCode, 429);
  const [[{ total }]] = await pool.query("SELECT COUNT(*) total FROM quiz_attempts WHERE tenant_id=? AND quiz_id='qz-q1'", [T]);
  assert.equal(Number(total), 10, 'exactly ten were recorded');
});
