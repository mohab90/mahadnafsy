'use strict';
/**
 * 5 Nov 2026: GET /api/me/student-extras answers in one request what the student dashboard asked five routes for (broadcasts, live streams, quizzes, the student's
 * quiz attempts, consultations). Against a real MariaDB, for a student who has all five and for one who has none: each piece is byte for byte what its own route
 * answers for the same student, one student never sees another's, a failing piece is null, and it is private. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-student-extras-it';
let pool, publicRouter, configRouter;

const clean = async () => {
  for (const table of ['quiz_attempts', 'course_quizzes', 'consultations', 'live_streams', 'enrollments', 'subscribers', 'users', 'courses']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
  await pool.query("DELETE FROM notification_reads WHERE tenant_id=?", [T]).catch(() => {});
  await pool.query("DELETE FROM tenant_settings WHERE tenant_id=?", [T]).catch(() => {});
  await pool.query("DELETE FROM tenants WHERE id=?", [T]).catch(() => {});
};
async function ask(router, path, user, query = {}) {
  const layer = router.stack.find(entry => entry.route?.path === path && entry.route.methods.get);
  const res = { statusCode: 200, body: undefined, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query, body: {}, headers: {}, tenantId: T, ip: '1', user: { uid: user.id, email: user.email, session_id: 's' }, get: () => undefined }, res);
  return res;
}
const rich = { id: 'se-u1', email: 'se-rich@x.t' };
const bare = { id: 'se-u2', email: 'se-bare@x.t' };

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  publicRouter = require('../../routes/public');
  configRouter = require('../../routes/config');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Extras IT', 'active')", [T, T]);
  for (const [index, user] of [rich, bare].entries()) {
    await pool.query("INSERT INTO users (id, tenant_id, email, phone, name, password_hash) VALUES (?, ?, ?, ?, 'م', 'x')", [user.id, T, user.email, `10197000${index}1`]);
    await pool.query("INSERT INTO subscribers (id, tenant_id, firebase_uid, client_code, name, email, phone, branch) VALUES (?, ?, ?, ?, 'طالب', ?, ?, 'ONLINE_EGYPT')", [`se-s${index}`, T, user.id, `SE${index}`, user.email, `10197000${index}1`]);
  }
  await pool.query(
    `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published)
     VALUES ('se-c1', ?, 'se-c1-it', 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 1000, 1)`, [T]);
  await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, status) VALUES (UUID(), ?, 'se-s0', 'se-c1', NOW(), 'active')", [T]);
  await pool.query("INSERT INTO course_quizzes (id, tenant_id, course_id, title, questions_json) VALUES ('se-q1', ?, 'se-c1', 'اختبار', ?)", [T, JSON.stringify([{ q: 'س', options: ['أ', 'ب'], correctIndex: 1 }])]);
  await pool.query("INSERT INTO quiz_attempts (id, tenant_id, subscriber_id, course_id, quiz_id, answers_json, score, passed) VALUES (UUID(), ?, 'se-s0', 'se-c1', 'se-q1', '[1]', 100, 1)", [T]);
  await pool.query("INSERT INTO live_streams (id, tenant_id, title, instructor_name, scheduled_at, stream_url, visibility) VALUES ('se-l1', ?, 'بث', 'م', NOW(), 'https://x.t/l', 'ALL_SUBSCRIBERS')", [T]);
  await pool.query("INSERT INTO consultations (id, tenant_id, subscriber_id, client_name, client_email, session_date) VALUES ('se-k1', ?, 'se-s0', 'طالب', ?, NOW())", [T, rich.email]);
  const { setTenantSetting } = require('../../lib/tenantSettings');
  await setTenantSetting('notifications', [{ id: 'se-n1', type: 'info', title: 'إعلان', active: true }], { tenantId: T });
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

const pieces = [
  ['notifications', () => configRouter, '/api/notifications/broadcasts', {}],
  ['liveStreams', () => publicRouter, '/api/live-streams', {}],
  ['quizzes', () => publicRouter, '/api/quizzes', { limit: '200' }],
  ['quizAttempts', () => publicRouter, '/api/me/quiz-attempts', {}],
  ['consultations', () => publicRouter, '/api/me/consultations', {}],
];

test('every piece is what its own route answers for the same student, for one who has all five and for one who has none', { skip }, async () => {
  for (const user of [rich, bare]) {
    const combined = await ask(publicRouter, '/api/me/student-extras', user);
    assert.equal(combined.statusCode, 200);
    for (const [name, router, path, query] of pieces) {
      const own = await ask(router(), path, user, query);
      assert.equal(JSON.stringify(combined.body[name]), JSON.stringify(own.body), `${user.id} ${name}`);
    }
    assert.deepEqual(Object.keys(combined.body).sort(), pieces.map(piece => piece[0]).sort());
  }
});

test('the rich student really has all five, and the other student sees none of them', { skip }, async () => {
  const a = (await ask(publicRouter, '/api/me/student-extras', rich)).body;
  assert.equal(a.notifications.notifications.length, 1);
  assert.deepEqual(a.liveStreams.map(row => row.id), ['se-l1']);
  assert.deepEqual(a.quizzes.map(row => row.id), ['se-q1']);
  assert.equal(a.quizAttempts.length, 1);
  assert.equal(a.consultations.length, 1);
  const b = (await ask(publicRouter, '/api/me/student-extras', bare)).body;
  assert.deepEqual([b.quizzes, b.quizAttempts, b.consultations], [[], [], []], 'what is another student\'s is not shown');
  assert.equal(b.quizzes.length, 0, 'a quiz of a course this student is not enrolled in is not listed');
});

test('it is private, and a piece that fails is null while the others are still answered', { skip }, async () => {
  assert.match((await ask(publicRouter, '/api/me/student-extras', rich)).headers['Cache-Control'], /private, no-store/);
  const original = pool.query.bind(pool);
  pool.query = (sql, ...rest) => (/FROM live_streams/.test(String(sql)) ? Promise.reject(new Error('boom')) : original(sql, ...rest));
  try {
    const res = await ask(publicRouter, '/api/me/student-extras', rich);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.liveStreams, null, 'the route answered 500, so the piece is null');
    assert.equal(res.body.consultations.length, 1);
    assert.equal(res.body.quizAttempts.length, 1);
  } finally { pool.query = original; }
});
