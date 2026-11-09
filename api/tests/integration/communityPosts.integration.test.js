'use strict';
/**
 * The community's posts as a member uses them, on a real MariaDB (these were regular expressions over routes/community.js and its migrations): only a
 * subscriber posts; a new post waits for review; only its author edits or deletes it (deleting takes its likes and comments); an edit that changes the
 * content sends it back to review; a like toggles once per member and counts; a comment needs text; and nothing reaches a post of another institute.
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
const T = 'tenant-community-it'; const OTHER = 'tenant-community-other';
let pool; let router; let seq = 0;

const A = { uid: 'u-cm-a', email: 'a-cm@example.test' };
const B = { uid: 'u-cm-b', email: 'b-cm@example.test' };
const STRANGER = { uid: 'u-cm-x', email: 'nobody-cm@example.test' };

async function call(method, path, { user, params = {}, body = {}, tenantId = T } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  seq += 1;
  const req = { params, body, query: {}, headers: {}, tenantId, user, ip: `10.9.${seq % 250}.${(seq >> 8) + 1}`, get: () => undefined, method: method.toUpperCase(), originalUrl: path, staffRecord: null, isSuperAdmin: false };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff', 'optionalAuth'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const tenant of [T, OTHER]) {
    for (const table of ['community_post_comments', 'community_post_likes', 'community_posts', 'subscribers']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [tenant]).catch(() => {});
  }
}
const post = async (user, title = 'سؤال') => {
  const res = await call('post', '/api/community/posts', { user, body: { title, body: 'نص المنشور' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.id || res.body.post?.id;
};
const status = async id => (await pool.query('SELECT status, title, likes FROM community_posts WHERE id=?', [id]))[0][0];
const approve = id => pool.query("UPDATE community_posts SET status='approved' WHERE id=?", [id]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/community');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active'), (?, ?, 'IT2', 'active')", [T, T, OTHER, OTHER]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, email, phone, branch, branch_id) VALUES
       ('sub-cm-a', ?, 'منى', ?, '01012000001', 'ONLINE_EGYPT', 'branch-online-egypt'),
       ('sub-cm-b', ?, 'سارة', ?, '01012000002', 'ONLINE_EGYPT', 'branch-online-egypt')`, [T, A.email, T, B.email]);
  await pool.query(
    "INSERT INTO community_posts (id, tenant_id, title, category, body, author, author_role, subscriber_id, tags, featured, pinned, likes, status, created_at) VALUES ('cp-foreign', ?, 'غريب', 'general', 'x', 'x', 'عضو', NULL, '[]', 0, 0, 0, 'approved', NOW())", [OTHER]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('only a subscriber posts; the post waits for review; a post needs a title and a body', { skip }, async () => {
  const refused = await call('post', '/api/community/posts', { user: STRANGER, body: { title: 'x', body: 'y' } });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.body.code, 'SUBSCRIBER_REQUIRED');
  assert.equal((await call('post', '/api/community/posts', { user: A, body: { title: '', body: 'y' } })).statusCode, 400);
  const id = await post(A);
  assert.equal((await status(id)).status, 'pending');
});

test('only the author edits or deletes a post; an edit that changes it sends it back to review', { skip }, async () => {
  const id = await post(A, 'أصل');
  await approve(id);
  const byOther = await call('patch', '/api/community/posts/:id', { user: B, params: { id }, body: { title: 'تعديل' } });
  assert.equal(byOther.statusCode, 403);
  assert.equal((await status(id)).title, 'أصل');
  assert.equal((await call('patch', '/api/community/posts/:id', { user: A, params: { id }, body: { title: 'أصل' } })).statusCode, 200);
  assert.equal((await status(id)).status, 'approved', 'saving it unchanged does not reopen the review');
  assert.equal((await call('patch', '/api/community/posts/:id', { user: A, params: { id }, body: { title: 'أحسن' } })).statusCode, 200);
  assert.deepEqual({ ...(await status(id)) }, { status: 'pending', title: 'أحسن', likes: 0 });
  assert.equal((await call('delete', '/api/community/posts/:id', { user: B, params: { id } })).statusCode, 404, 'another member\'s delete finds nothing of theirs');
  assert.ok(await status(id));
  assert.equal((await call('patch', '/api/community/posts/:id', { user: A, params: { id: 'cp-foreign' }, body: { title: 'x' } })).statusCode, 404, 'another institute\'s post is not found');
});

test('a like toggles once per member and counts; a comment needs text; only an approved post takes either', { skip }, async () => {
  const id = await post(A, 'للتفاعل');
  assert.equal((await call('post', '/api/community/posts/:id/like', { user: B, params: { id } })).statusCode, 404, 'a pending post takes no like');
  await approve(id);
  const liked = await call('post', '/api/community/posts/:id/like', { user: B, params: { id } });
  assert.deepEqual([liked.body.liked, liked.body.likes], [true, 1]);
  const unliked = await call('post', '/api/community/posts/:id/like', { user: B, params: { id } });
  assert.deepEqual([unliked.body.liked, unliked.body.likes], [false, 0]);
  await call('post', '/api/community/posts/:id/like', { user: B, params: { id } });
  assert.equal((await call('post', '/api/community/posts/:id/comments', { user: B, params: { id }, body: { body: '   ' } })).statusCode, 400);
  const comment = await call('post', '/api/community/posts/:id/comments', { user: B, params: { id }, body: { body: 'تعليق' } });
  assert.equal(comment.statusCode, 200, JSON.stringify(comment.body));
  assert.equal((await call('post', '/api/community/posts/:id/like', { user: STRANGER, params: { id } })).statusCode, 403);

  const gone = await call('delete', '/api/community/posts/:id', { user: A, params: { id } });
  assert.equal(gone.statusCode, 200);
  const [[left]] = await pool.query("SELECT (SELECT COUNT(*) FROM community_post_likes WHERE post_id=?) AS likes, (SELECT COUNT(*) FROM community_post_comments WHERE post_id=?) AS comments", [id, id]);
  assert.deepEqual([Number(left.likes), Number(left.comments)], [0, 0], 'the post takes its likes and comments with it');
});
