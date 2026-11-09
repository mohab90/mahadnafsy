'use strict';
/**
 * The lecturer's own portal («حساب محاضر»), on a real MariaDB (these were regular expressions over routes/lecturer-portal.js and lib/lecturerPortal.js —
 * `LECTURER_ONLY`, the students query that asked for a column that does not exist and answered 500 for every lecturer, `PAYOUT_NOTHING` / `PAYOUT_RECENT`,
 * `COMMENT_NOT_YOURS`, `POST_NOT_YOURS`): only a lecturer's account is let in; the students tab and the earnings answer for the lecturer's own courses and fees only; a payout
 * request needs something approved, tells the accounts team once, and is refused for three days; in the community the lecturer posts without review, and takes down a comment on
 * their own post or one they wrote — nobody else's — and deletes only their own posts. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-lecturer-it';
let pool; let router;

const staff = (id, role, permissions = ['use_lecturer_portal']) => ({ id, name: id === 'st-lp-dr' ? 'د. منى' : id, role, permissions_json: JSON.stringify(permissions) });
const LECTURER = staff('st-lp-dr', 'instructor');
const OTHER_LECTURER = staff('st-lp-dr2', 'instructor');
const NOT_A_LECTURER = staff('st-lp-sales', 'sales');

async function call(method, path, { params = {}, body = {}, query = {}, who = LECTURER } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query, headers: {}, tenantId: T, user: { uid: 'u', email: `${who.id}@example.test`, tenant_id: T }, staffRecord: who, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, error => { if (error) throw error; advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['notifications', 'community_post_comments', 'community_post_likes', 'community_posts', 'instructor_fees', 'enrollments', 'courses', 'subscribers', 'therapists', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/lecturer-portal');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-lp-dr', ?, 'د. منى', 'dr-lp@example.test', '1019550001', 'INSTRUCTOR', 1, '2025-01-01'),
       ('st-lp-dr2', ?, 'د. آخر', 'dr2-lp@example.test', '1019550002', 'INSTRUCTOR', 1, '2025-01-01'),
       ('st-lp-sales', ?, 'مندوب', 'sales-lp@example.test', '1019550003', 'SALES', 1, '2025-01-01')`, [T, T, T]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp, instructor_id) VALUES
       ('co-lp-1', ?, 'كورس المحاضرة', '', '', '', '', 'GENERAL', 'RECORDED', 1000, 'st-lp-dr'),
       ('co-lp-2', ?, 'كورس المحاضر الآخر', '', '', '', '', 'GENERAL', 'RECORDED', 1000, 'st-lp-dr2')`, [T, T]);
  for (const [id, phone, course] of [['sub-lp-1', '1019550010', 'co-lp-1'], ['sub-lp-2', '1019550011', 'co-lp-2']]) {
    await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES (?, ?, ?, ?, 'ONLINE_EGYPT', 'branch-online-egypt')", [id, T, `طالبة ${id}`, phone]);
    await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, status, access_type, enrolled_at) VALUES (UUID(), ?, ?, ?, 'active', 'full', NOW())", [T, id, course]);
  }
  const fee = (id, staffId, amount, status) => pool.query(
    "INSERT INTO instructor_fees (id, tenant_id, staff_id, fee_type, total_amount, currency, period_month, period_year, status) VALUES (?, ?, ?, 'lecture', ?, 'EGP', 10, 2026, ?)", [id, T, staffId, amount, status]);
  await fee('if-lp-1', 'st-lp-dr', 400, 'approved'); await fee('if-lp-2', 'st-lp-dr', 100, 'pending'); await fee('if-lp-3', 'st-lp-dr', 250, 'paid'); await fee('if-lp-4', 'st-lp-dr2', 9000, 'approved');
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('only a lecturer\'s account is let in, and the students tab and the earnings answer for their own courses and fees', { skip }, async () => {
  const refused = await call('get', '/api/staff/lecturer/students', { who: NOT_A_LECTURER });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.body.code, 'LECTURER_ONLY');

  const students = await call('get', '/api/staff/lecturer/students');
  assert.equal(students.statusCode, 200, JSON.stringify(students.body));
  assert.deepEqual(students.body.online.map(item => item.id), ['sub-lp-1'], 'the students of their own courses, not the other lecturer\'s');
  assert.deepEqual(students.body.courses.map(item => item.id), ['co-lp-1']);

  const earnings = await call('get', '/api/staff/lecturer/earnings');
  assert.equal(earnings.statusCode, 200, JSON.stringify(earnings.body));
  assert.deepEqual([earnings.body.totals.waiting, earnings.body.totals.approved, earnings.body.totals.paid], [100, 400, 250], 'their fees by status; the other lecturer\'s 9,000 is not here');
});

test('a payout request needs something approved, tells the accounts team once, and is refused for three days', { skip }, async () => {
  const otherAsks = await call('post', '/api/staff/lecturer/payout-request', { who: OTHER_LECTURER });
  assert.equal(otherAsks.statusCode, 200, 'the other lecturer has 9,000 approved, and asks for it');
  await pool.query("UPDATE instructor_fees SET status='paid' WHERE staff_id='st-lp-dr2'");
  await pool.query("DELETE FROM notifications WHERE tenant_id=?", [T]);
  const none = await call('post', '/api/staff/lecturer/payout-request', { who: OTHER_LECTURER });
  assert.equal(none.statusCode, 409);
  assert.equal(none.body.code, 'PAYOUT_NOTHING', 'nothing approved, nothing to ask for');

  const first = await call('post', '/api/staff/lecturer/payout-request');
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.body.amount, 400);
  const told = (await pool.query("SELECT id FROM notifications WHERE tenant_id=? AND type='payroll'", [T]))[0];
  assert.equal(told.length, 1, 'the accounts team is told');
  const again = await call('post', '/api/staff/lecturer/payout-request');
  assert.equal(again.statusCode, 429);
  assert.equal(again.body.code, 'PAYOUT_RECENT');
  assert.equal((await pool.query("SELECT id FROM notifications WHERE tenant_id=? AND type='payroll'", [T]))[0].length, 1, 'and not told twice');
});

test('in the community the lecturer posts without review, takes down comments on their own posts or their own, and deletes only their own posts', { skip }, async () => {
  assert.equal((await call('post', '/api/staff/lecturer/community/posts', { body: { title: '' , body: 'x' } })).body.code, 'POST_REQUIRED');
  const post = await call('post', '/api/staff/lecturer/community/posts', { body: { title: 'نصيحة', body: 'اشربوا مياه' } });
  assert.equal(post.statusCode, 200, JSON.stringify(post.body));
  assert.equal((await pool.query('SELECT status FROM community_posts WHERE id=?', [post.body.id]))[0][0].status, 'approved', 'a lecturer\'s post needs no review');
  assert.equal((await call('post', '/api/staff/lecturer/community/posts/:id/comments', { params: { id: 'nope' }, body: { body: 'x' } })).body.code, 'POST_NOT_FOUND');
  assert.equal((await call('post', '/api/staff/lecturer/community/posts/:id/comments', { params: { id: post.body.id }, body: { body: '' } })).body.code, 'COMMENT_REQUIRED');

  // a client's comment on the lecturer's post, the lecturer's own comment on it, and a comment on another lecturer's post
  await pool.query("INSERT INTO community_posts (id, tenant_id, title, category, body, author, author_role, staff_id, status, created_at) VALUES ('post-lp-other', ?, 'ت', 'general', 'ب', 'د. آخر', 'محاضر', 'st-lp-dr2', 'approved', NOW())", [T]);
  await pool.query("INSERT INTO community_post_comments (id, tenant_id, post_id, subscriber_id, author, body, created_at) VALUES ('cm-lp-client', ?, ?, 'sub-lp-1', 'طالبة', 'سؤال', NOW()), ('cm-lp-elsewhere', ?, 'post-lp-other', 'sub-lp-2', 'طالبة', 'سؤال', NOW())", [T, post.body.id, T]);
  const own = await call('post', '/api/staff/lecturer/community/posts/:id/comments', { params: { id: 'post-lp-other' }, body: { body: 'ردّي' } });
  assert.equal(own.statusCode, 200);
  const remove = id => call('delete', '/api/staff/lecturer/community/comments/:id', { params: { id } });
  assert.equal((await remove('cm-lp-client')).statusCode, 200, 'a comment on their own post');
  assert.equal((await remove(own.body.comment.id)).statusCode, 200, 'their own comment, even on someone else\'s post');
  const foreign = await remove('cm-lp-elsewhere');
  assert.equal(foreign.statusCode, 404);
  assert.equal(foreign.body.code, 'COMMENT_NOT_YOURS', 'nobody else\'s post is theirs to moderate');
  assert.equal((await pool.query("SELECT id FROM community_post_comments WHERE id='cm-lp-elsewhere'"))[0].length, 1);

  const liked = await call('post', '/api/staff/lecturer/community/posts/:id/like', { params: { id: post.body.id } });
  assert.equal(liked.body.liked, true);
  assert.equal((await call('post', '/api/staff/lecturer/community/posts/:id/like', { params: { id: post.body.id } })).body.liked, false, 'once per member');

  const notMine = await call('delete', '/api/staff/lecturer/community/posts/:id', { params: { id: 'post-lp-other' } });
  assert.equal(notMine.statusCode, 404);
  assert.equal(notMine.body.code, 'POST_NOT_YOURS');
  assert.equal((await call('delete', '/api/staff/lecturer/community/posts/:id', { params: { id: post.body.id } })).statusCode, 200);
});
