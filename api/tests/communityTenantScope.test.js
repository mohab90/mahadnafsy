'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const community = fs.readFileSync(path.join(root, 'routes', 'community.js'), 'utf8');
const lms = fs.readFileSync(path.join(root, 'routes', 'lms.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '071_v25_community_tenant_scope.sql'), 'utf8');
const engagementMigration = fs.readFileSync(path.join(root, 'migrations', '148_v25_community_engagement_integrity.sql'), 'utf8');

test('all community storage tables receive tenant columns and indexes', () => {
  for (const table of ['community_posts', 'community_library', 'community_videos', 'community_events', 'forum_posts', 'forum_upvotes']) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table}[\\s\\S]*?tenant_id`, 'i'), `${table} missing tenant migration`);
  }
});

test('community public/admin reads and mutations use the resolved tenant', () => {
  assert.match(community, /community_posts WHERE tenant_id=\?/);
  assert.match(community, /community_library WHERE tenant_id=\?/);
  assert.match(community, /community_videos WHERE tenant_id=\?/);
  assert.match(community, /community_events WHERE tenant_id=\?/);
  assert.match(community, /DELETE FROM community_posts WHERE tenant_id=\? AND id=\?/);
  assert.doesNotMatch(community, /DELETE FROM community_(?:posts|library|videos|events) WHERE id\s*=\s*\?/);
});

test('community cache and subscriber identity are tenant-bound', () => {
  assert.match(community, /community:\$\{req\.tenantId/);
  assert.match(community, /FROM subscribers[\s\S]*?WHERE tenant_id=\?/);
  assert.doesNotMatch(community, /const subId = .*req\.user/);
});

test('forum detail, upvote and moderation are tenant-bound and transactional', () => {
  const forumWindow = lms.slice(lms.indexOf("router.get('/api/community/posts/:id'"), lms.indexOf('module.exports = router'));
  assert.match(forumWindow, /forum_posts WHERE tenant_id=\?/);
  assert.match(forumWindow, /forum_upvotes WHERE tenant_id=\?/);
  assert.match(forumWindow, /beginTransaction\(\)/);
  assert.match(forumWindow, /commit\(\)/);
  assert.match(forumWindow, /rollback\(\)/);
});

test('customer post creation is rate limited (MKT-16)', () => {
  assert.match(community, /router\.post\('\/api\/community\/posts',\s*requireAuth,\s*communityPostLimiter/);
});

test('customer PATCH/DELETE of a community post check subscriber ownership before mutating (MKT-16)', () => {
  const patchWindow = community.slice(community.indexOf("router.patch('/api/community/posts/:id'"), community.indexOf("router.delete('/api/community/posts/:id'"));
  assert.match(patchWindow, /existing\.subscriber_id !== subscriber\.id/);
  assert.match(patchWindow, /WHERE tenant_id=\? AND id=\?/);

  const deleteWindow = community.slice(community.indexOf("router.delete('/api/community/posts/:id'"), community.indexOf("// Community Library"));
  assert.match(deleteWindow, /DELETE FROM community_posts WHERE tenant_id=\? AND id=\? AND subscriber_id=\?/);
});

test('community likes and comments are tenant-scoped server truth', () => {
  assert.match(engagementMigration, /CREATE TABLE IF NOT EXISTS community_post_likes/);
  assert.match(engagementMigration, /PRIMARY KEY \(tenant_id, post_id, subscriber_id\)/);
  assert.match(engagementMigration, /CREATE TABLE IF NOT EXISTS community_post_comments/);
  assert.match(engagementMigration, /idx_community_comments_post \(tenant_id, post_id, created_at\)/);

  const likeWindow = community.slice(
    community.indexOf("router.post('/api/community/posts/:id/like'"),
    community.indexOf("router.post('/api/community/posts/:id/comments'"),
  );
  assert.match(likeWindow, /beginTransaction\(\)/);
  assert.match(likeWindow, /community_post_likes WHERE tenant_id=\? AND post_id=\? AND subscriber_id=\?/);
  assert.match(likeWindow, /UPDATE community_posts SET likes=/);
  assert.match(likeWindow, /commit\(\)/);
  assert.match(likeWindow, /rollback\(\)/);

  const commentWindow = community.slice(
    community.indexOf("router.post('/api/community/posts/:id/comments'"),
    community.indexOf("// Customer delete"),
  );
  assert.match(commentWindow, /INSERT INTO community_post_comments/);
  assert.match(commentWindow, /tenant_id, post_id, subscriber_id/);
  assert.match(community, /commentsList: grouped\.get\(row\.id\)/);
});
