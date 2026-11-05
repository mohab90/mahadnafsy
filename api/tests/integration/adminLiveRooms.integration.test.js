'use strict';
/**
 * 5 Nov 2026: a live created in the administration with NO link gets its room from the institute's Zoom / Google Meet account (lib/meetingProvider.js) — the join link, the
 * host link and the meeting kept on the live; a live the system made a room for, moved to another time, gets a new room and the old one is taken down; a link typed by
 * hand is kept as typed and replaces a made room; an edit that resends the stored link changes nothing; deleting the live takes its room down; a provider that fails
 * saves nothing; and a link that is not https is refused. Zoom is stood in for by a stub: no network. Runs only with DB_*.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-admin-live-rooms-it';
let pool, router, provider, realFetch, calls, nextMeeting, zoomDown;

const clean = async () => {
  await pool.query('DELETE FROM live_streams WHERE tenant_id=?', [T]).catch(() => {});
  await pool.query('DELETE FROM tenant_settings WHERE tenant_id=?', [T]).catch(() => {});
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
};
function stubZoom() {
  realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push(`${method} ${String(url).replace(/\?.*/, '')}`);
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (String(url).includes('zoom.us/oauth/token')) return json(200, { access_token: 'tok', expires_in: 3000 });
    if (zoomDown) return json(500, { message: 'down' });
    if (method === 'POST' && /\/users\/[^/]+\/meetings$/.test(String(url))) {
      const id = ++nextMeeting;
      return json(201, { id, join_url: `https://zoom.us/j/${id}`, start_url: `https://zoom.us/s/${id}`, password: 'p' });
    }
    if (method === 'DELETE' && /\/meetings\/\d+$/.test(String(url))) return { ok: true, status: 204, json: async () => ({}) };
    return json(404, {});
  };
}
async function save(body) {
  const layer = router.stack.find(entry => entry.route?.path === '/api/admin/live-streams' && entry.route.methods.post);
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query: {}, body, headers: {}, tenantId: T, user: { uid: 'admin' }, ip: '1', get: () => undefined }, res);
  return res;
}
async function remove(id) {
  const layer = router.stack.find(entry => entry.route?.path === '/api/admin/live-streams/:id' && entry.route.methods.delete);
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: { id }, query: {}, body: {}, headers: {}, tenantId: T, user: { uid: 'admin' }, ip: '1', get: () => undefined }, res);
  return res;
}
const row = async id => (await pool.query('SELECT stream_url, platform, host_url, meeting_id, meeting_provider, scheduled_at FROM live_streams WHERE id=? AND tenant_id=?', [id, T]))[0][0];
const live = (over = {}) => ({ title: 'لايف', instructorName: 'د. م', scheduledAt: '2026-12-01 10:00:00', durationMinutes: 60, status: 'UPCOMING', platform: 'ZOOM', ...over });
const settle = () => new Promise(resolve => setTimeout(resolve, 80));

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/core/catalog');
  provider = require('../../lib/meetingProvider');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Rooms IT', 'active')", [T, T]);
  nextMeeting = 100;
  stubZoom();
});
after(async () => { if (ENABLED) { global.fetch = realFetch; await clean(); await pool.end(); } });
beforeEach(() => { calls = []; zoomDown = false; });

test('before the account is set up, a live keeps the link it was given and nothing is asked of Zoom', { skip }, async () => {
  const res = await save(live({ id: 'lr-0', streamUrl: 'https://youtube.com/live/abc' }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.systemMade, false);
  assert.equal((await row('lr-0')).stream_url, 'https://youtube.com/live/abc');
  assert.deepEqual(calls, [], 'no request left the server');
});

test('with the account set up, a new live with no link gets its room: join link, host link, meeting', { skip }, async () => {
  await provider.saveIntegration(T, { provider: 'zoom', zoom: { accountId: 'acc', clientId: 'cid', clientSecret: 'sec', hostUser: 'me' } });
  calls = [];
  const res = await save(live({ id: 'lr-1' }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.systemMade, true);
  const saved = await row('lr-1');
  assert.deepEqual([saved.stream_url, saved.host_url, saved.meeting_provider, saved.platform], ['https://zoom.us/j/101', 'https://zoom.us/s/101', 'zoom', 'ZOOM']);
  assert.equal(String(saved.meeting_id), '101');
  assert.equal(calls.filter(call => call.startsWith('POST') && call.includes('/meetings')).length, 1, 'one meeting made');
});

test('a link typed by hand is kept as typed and no room is made', { skip }, async () => {
  const res = await save(live({ id: 'lr-2', streamUrl: 'https://meet.example.com/mine' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.systemMade, false);
  const saved = await row('lr-2');
  assert.equal(saved.stream_url, 'https://meet.example.com/mine');
  assert.equal(saved.meeting_id, null);
  assert.equal(calls.some(call => call.includes('/meetings')), false);
});

test('an edit that sends the stored link back changes nothing: no new room, the old one is not taken down', { skip }, async () => {
  const before = await row('lr-1');
  const res = await save(live({ id: 'lr-1', title: 'اسم جديد', streamUrl: before.stream_url }));
  assert.equal(res.statusCode, 200);
  await settle();
  assert.deepEqual(calls.filter(call => call.includes('/meetings')), [], 'no meeting made or deleted');
  const after = await row('lr-1');
  assert.deepEqual([after.stream_url, String(after.meeting_id), after.host_url], [before.stream_url, '101', before.host_url]);
});

test('an edit that sends no link keeps the one the live has, for a live typed by hand too', { skip }, async () => {
  const res = await save(live({ id: 'lr-2', title: 'تعديل' }));
  assert.equal(res.statusCode, 200);
  assert.equal((await row('lr-2')).stream_url, 'https://meet.example.com/mine', 'a hand-typed link is never replaced by a made room');
  assert.equal(calls.some(call => call.includes('/meetings')), false);
});

test('a live the system made a room for, moved to another time, gets a new room and the old one is taken down', { skip }, async () => {
  const res = await save(live({ id: 'lr-1', scheduledAt: '2026-12-02 10:00:00', streamUrl: (await row('lr-1')).stream_url }));
  assert.equal(res.statusCode, 200);
  await settle();
  const saved = await row('lr-1');
  assert.equal(saved.stream_url, 'https://zoom.us/j/102');
  assert.equal(String(saved.meeting_id), '102');
  assert.equal(calls.includes('DELETE https://api.zoom.us/v2/meetings/101'), true, 'the old room was taken down');
});

test('a link typed over a made room replaces it, and the room is taken down', { skip }, async () => {
  const res = await save(live({ id: 'lr-1', scheduledAt: '2026-12-02 10:00:00', streamUrl: 'https://my.link/now' }));
  assert.equal(res.statusCode, 200);
  await settle();
  const saved = await row('lr-1');
  assert.deepEqual([saved.stream_url, saved.meeting_id, saved.host_url, saved.meeting_provider], ['https://my.link/now', null, null, null]);
  assert.equal(calls.includes('DELETE https://api.zoom.us/v2/meetings/102'), true);
});

test('deleting a live takes its room down', { skip }, async () => {
  const made = await save(live({ id: 'lr-3' }));
  assert.equal(made.body.systemMade, true);
  const id = String((await row('lr-3')).meeting_id);
  calls = [];
  assert.equal((await remove('lr-3')).statusCode, 200);
  await settle();
  assert.equal(calls.includes(`DELETE https://api.zoom.us/v2/meetings/${id}`), true);
});

test('when the provider fails the live is not saved with no link, and the administration is told', { skip }, async () => {
  zoomDown = true;
  const res = await save(live({ id: 'lr-4' }));
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'LIVE_ROOM');
  assert.equal(await row('lr-4'), undefined, 'nothing was saved');
});

test('a link that is not https is refused, not saved to be opened later', { skip }, async () => {
  for (const link of ['javascript:alert(1)', 'http://x.t/live', 'data:text/html,x']) {
    const res = await save(live({ id: 'lr-5', streamUrl: link }));
    assert.equal(res.statusCode, 400, link);
  }
  assert.equal(await row('lr-5'), undefined);
});
