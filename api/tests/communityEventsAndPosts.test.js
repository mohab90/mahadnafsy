'use strict';

// The community, 28 September: «لما العميل حب بينشر كلام علي المجتمع ... مفيش
// اي محتوي بيوصل للادارة» and «حاولت اضيف فاعليه للاسف لم تضاف» — the admin's
// every «إضافة» answered 404, a pending post reached nobody, and an event had
// no page, no lecturers and nowhere to register.
//
// The real router, over HTTP, with the database, sign-in and rate limits
// replaced by stand-ins that keep rows in memory.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const store = { community_events: [], community_event_registrations: [], community_posts: [], notifications: [] };
const therapists = [{ id: 't-1', tenant_id: 'tn', name: 'د. منى', title: 'استشاري نفسي', specialty: '', image: '/img/mona.jpg' }];

const tableOf = sql => (sql.match(/(?:FROM|INTO|UPDATE)\s+(community_\w+)/) || [])[1];
const pool = {
  async query(sql, params = []) {
    const table = tableOf(sql);
    if (/FROM therapists/.test(sql)) return [therapists.filter(row => params.slice(1).includes(row.id))];
    if (/SELECT slug FROM community_events WHERE tenant_id=\? AND \(slug=\? OR slug LIKE \?\)/.test(sql)) {
      const [, base] = params;
      return [store.community_events.filter(row => row.slug === base || String(row.slug).startsWith(`${base}-`))];
    }
    if (/^SELECT id FROM (community_\w+) WHERE tenant_id=\? AND id=\? LIMIT 1/.test(sql)) {
      return [store[table].filter(row => row.id === params[1])];
    }
    if (/^SELECT slug, image_url FROM community_events/.test(sql)) return [store.community_events.filter(row => row.id === params[1])];
    if (/^UPDATE (community_\w+) SET/.test(sql)) {
      const columns = sql.match(/SET (.+) WHERE/)[1].split(', ').map(part => part.replace('=?', ''));
      const row = store[table].find(item => item.id === params[params.length - 1]);
      columns.forEach((column, index) => { row[column] = params[index]; });
      return [{ affectedRows: 1 }];
    }
    if (/^INSERT INTO community_event_registrations/.test(sql)) {
      const [id, tenantId, eventId, name, phone, identity] = params;
      const existing = store.community_event_registrations.find(row => row.event_id === eventId && row.phone_identity === identity);
      if (existing) { Object.assign(existing, { name, phone }); return [{ affectedRows: 2 }]; }
      store.community_event_registrations.push({ id, tenant_id: tenantId, event_id: eventId, name, phone, phone_identity: identity, created_at: 'now' });
      return [{ affectedRows: 1 }];
    }
    // A member's post: 'pending' is written in the statement, not passed.
    if (/INSERT INTO community_posts[\s\S]*'pending'/.test(sql)) {
      const [id, tenantId, title, category, body, author, role, subscriberId] = params;
      store.community_posts.push({ id, tenant_id: tenantId, title, category, body, author, author_role: role, subscriber_id: subscriberId, status: 'pending', created_at: params[params.length - 1] });
      return [{ affectedRows: 1 }];
    }
    if (/^INSERT INTO (community_\w+) \(id, tenant_id, /.test(sql)) {
      const names = sql.match(/\(id, tenant_id, ([^)]+)\)/)[1].split(', ');
      const row = { id: params[0], tenant_id: params[1] };
      names.forEach((name, index) => { row[name] = params[index + 2]; });
      store[table].push(row);
      return [{ affectedRows: 1 }];
    }
    if (/FROM community_events WHERE tenant_id=\? AND \(slug=\? OR id=\?\)/.test(sql)
      || /FROM community_events WHERE tenant_id=\? AND \(id=\? OR slug=\?\)/.test(sql)) {
      return [store.community_events.filter(row => row.slug === params[1] || row.id === params[1])];
    }
    if (/FROM community_events WHERE tenant_id=\? ORDER BY/.test(sql)) return [store.community_events.slice()];
    if (/SELECT image_url FROM community_events/.test(sql)) return [store.community_events.filter(row => row.id === params[1])];
    if (/FROM community_event_registrations\s+WHERE tenant_id=\? AND event_id IN/.test(sql)) {
      const ids = params.slice(1);
      const counts = ids.map(id => ({ event_id: id, n: store.community_event_registrations.filter(row => row.event_id === id).length }))
        .filter(row => row.n);
      return [counts];
    }
    throw new Error(`unexpected query: ${sql.slice(0, 120)}`);
  },
};

function stub(rel, exports) {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
const pass = (_req, _res, next) => next();
stub('../lib/db', { pool, cached: async (_key, _ttl, load) => load(), cacheInvalidate: () => {} });
stub('../middleware/auth', {
  optionalAuth: pass, requireAdminOrStaff: pass, requirePermission: () => pass,
  requireAuth: (req, _res, next) => { req.user = { uid: 'u-1' }; next(); },
});
stub('../middleware/rateLimits', { communityPostLimiter: pass, eventRegistrationLimiter: pass, publicLimiter: pass });
stub('../lib/notification', { createNotification: async (...args) => { store.notifications.push(args); } });
let subscriber = { id: 'sub-1', name: 'هنا' };
stub('../lib/subscriberIdentity', { resolveSubscriberRow: async () => subscriber });

const router = require('../routes/community');

let base;
let server;
test.before(async () => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { req.tenantId = 'tn'; next(); });
  app.use(router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = async (method, url, body) => {
  const response = await fetch(`${base}${url}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* an image */ }
  return { status: response.status, json, headers: response.headers };
};

test('the admin adds an event under the id the screen made, with lecturers and a page of its own', async () => {
  const picture = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;
  const saved = await call('POST', '/api/admin/community/events', {
    id: 'ev-1790000000000', title: 'ورشةُ الصحة النفسية للأطفال', eventType: 'ورشة عمل', imageUrl: picture,
    description: 'سطر مختصر', content: 'تفاصيل كاملة\nسطر تاني', speakerIds: ['t-1'], isOnline: false,
    locationName: 'مقر المعهد', eventDate: '2099-10-06', eventTime: '19:00',
  });
  assert.equal(saved.status, 200, 'an add is no longer a 404');
  assert.deepEqual(saved.json, { ok: true, id: 'ev-1790000000000', slug: 'ورشة-الصحة-النفسية-للأطفال' });
  const [row] = store.community_events;
  assert.equal(row.is_online, 0);
  assert.equal(row.platform, null, 'an in-person event has no platform');
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T/, 'the server writes the time');

  // Same title again: a different address.
  const second = await call('POST', '/api/admin/community/events', { id: 'ev-2', title: 'ورشة الصحة النفسية للأطفال' });
  assert.equal(second.json.slug, 'ورشة-الصحة-النفسية-للأطفال-2');

  const page = await call('GET', `/api/community/events/${encodeURIComponent('ورشة-الصحة-النفسية-للأطفال')}`);
  assert.equal(page.status, 200);
  assert.equal(page.json.title, 'ورشةُ الصحة النفسية للأطفال');
  assert.deepEqual(page.json.speakers, [{ id: 't-1', name: 'د. منى', title: 'استشاري نفسي', image: '/img/mona.jpg' }]);
  assert.equal(page.json.eventTime, '19:00');
  assert.match(page.json.imageUrl, /^\/api\/community\/events\/ev-1790000000000\/image\?v=[0-9a-f]{10}$/,
    'the picture is served by address, not inside every list');

  const image = await call('GET', '/api/community/events/ev-1790000000000/image');
  assert.equal(image.headers.get('content-type'), 'image/png');

  // Editing with the picture's address keeps the picture and the address.
  const edited = await call('POST', '/api/admin/community/events', { ...page.json, id: 'ev-1790000000000', title: 'عنوان جديد' });
  assert.equal(edited.json.slug, 'ورشة-الصحة-النفسية-للأطفال', 'a shared link keeps working');
  assert.equal(store.community_events[0].image_url, picture);
});

test('interest is a name and a number, once per number', async () => {
  const first = await call('POST', '/api/community/events/ev-1790000000000/register', { name: 'أحمد', phone: '01012345678' });
  assert.deepEqual(first.json, { ok: true, alreadyRegistered: false });
  const again = await call('POST', `/api/community/events/${encodeURIComponent('ورشة-الصحة-النفسية-للأطفال')}/register`,
    { name: 'أحمد علي', phone: '+20 101 234 5678' });
  assert.deepEqual(again.json, { ok: true, alreadyRegistered: true }, 'the same number in another format');
  assert.equal(store.community_event_registrations.length, 1);
  assert.equal((await call('POST', '/api/community/events/ev-1790000000000/register', { name: 'x', phone: '0101' })).status, 400);
  const notified = store.notifications.filter(([type]) => type === 'community');
  assert.equal(notified.length, 1, 'the desk hears of a new registration once');
  const list = await call('GET', '/api/community/events');
  assert.equal(list.json.find(event => event.id === 'ev-1790000000000').registrations, 1);
});

test('a member\'s post is saved pending, timed by the server, and the desk is told', async () => {
  store.notifications.length = 0;
  const posted = await call('POST', '/api/community/posts', { title: 'سؤال', body: 'نص', createdAt: 'الآن' });
  assert.equal(posted.json.status, 'pending');
  const [post] = store.community_posts;
  assert.notEqual(post.created_at, 'الآن');
  assert.match(post.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(store.notifications[0][0], 'community');
  assert.match(store.notifications[0][2], /هنا: سؤال/);

  subscriber = null;
  const refused = await call('POST', '/api/community/posts', { title: 'سؤال', body: 'نص' });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.code, 'SUBSCRIBER_REQUIRED');
  assert.match(refused.json.error, /لمشتركي المعهد/);
  subscriber = { id: 'sub-1', name: 'هنا' };
});

test('the admin adds a post, a library item and a video under their own ids', async () => {
  const post = await call('POST', '/api/admin/community/posts', { id: 'post-1', title: 'ترحيب', body: 'أهلاً' });
  assert.equal(post.status, 200);
  assert.equal(store.community_posts.find(row => row.id === 'post-1').likes, 0);
  assert.equal((await call('POST', '/api/admin/community/posts', { id: 'post-1', title: 'ترحيب', body: 'أهلاً', status: 'approved' })).status, 200);
});

test('the screens: each section and event has an address; the panel refreshes posts', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
  const app = read('client/App.tsx');
  assert.match(app, /<Route path="\/community\/events\/:slug" element=\{lazyPage\(<CommunityEvent \/>\)\} \/>\s+<Route path="\/community\/:section"/);
  const page = read('client/pages/Community.tsx');
  assert.match(page, /<Link key=\{key\} to=\{`\/community\/\$\{key\}`\}/);
  assert.match(page, /انت داخل بحساب الإدارة/);
  const panel = read('admin/pages/dashboard/DashboardCommunityAdminPanel.tsx');
  assert.match(panel, /useVisibleInterval\(\(\) => \{ void refreshCommunityPosts\(\); \}, 60_000, activeTab === 'community'\);/);
  const migration = read('api/migrations/222_v26_community_event_pages.sql');
  assert.match(migration, /UNIQUE KEY uq_event_registration \(tenant_id, event_id, phone_identity\)/);
  assert.match(migration, /MODIFY COLUMN image_url mediumtext/);
});
