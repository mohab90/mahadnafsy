'use strict';
/**
 * Owner's decision of 11 Nov 2026: each employee sees ONLY the conversations of their own leads in the team inbox — the caller's lead data
 * scope on every route (list, counts, a thread, its messages, the contact panel, reply, assign, notes, labels, search, stats) and on every
 * notification. Two reps, a manager (scope «everything»), a branch-scoped role and a named triager, against a real MariaDB.
 * Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
process.env.WHATSAPP_OUTBOUND_CATEGORIES = 'all';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-inbox-scope-it';
let pool, router;

const sentToMeta = [];
const realFetch = global.fetch;
const REP_A = { id: 'is-rep-a', name: 'سارة', role: 'sales', data_scope: null };
const REP_B = { id: 'is-rep-b', name: 'أحمد', role: 'sales', data_scope: null };
const MANAGER = { id: 'is-boss', name: 'المدير', role: 'admin', data_scope: 'all' };
const BRANCH = { id: 'is-branch', name: 'فرع', role: 'sales', data_scope: 'branch:ONLINE_SAUDI' };

async function clean() {
  for (const table of ['notifications', 'inbox_notes', 'inbox_threads', 'communications', 'leads', 'subscribers', 'staff', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [TENANT]).catch(() => {});
}
async function call(method, path, { as, params = {}, query = {}, body = {} } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, path);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await layer.route.stack.at(-1).handle({
    params, body, query, headers: {}, tenantId: TENANT, user: { uid: as.id }, staffRecord: as, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}
const ids = res => res.body.threads.map(thread => thread.id).sort();

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/team-inbox');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'Inbox Scope IT', 'active')", [TENANT, TENANT]);
  for (const [id, role] of [['is-rep-a', 'SALES'], ['is-rep-b', 'SALES'], ['is-boss', 'ADMIN'], ['is-branch', 'SALES'], ['is-triager', 'SALES']]) {
    await pool.query(
      `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES (?,?,?,?,?,?,1,'2025-01-01')`,
      [id, TENANT, id, `${id}@inbox-scope.test`, `0109309${String(Math.floor(Math.random() * 9000) + 1000)}`, role]);
  }
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, branch, assigned_sales_id) VALUES
       ('is-lead-a', ?, 'عميلة سارة', '1019300001', 'fb', 'new', 0, 'ONLINE_EGYPT', 'is-rep-a'),
       ('is-lead-b', ?, 'عميلة أحمد', '1019300002', 'fb', 'new', 0, 'ONLINE_EGYPT', 'is-rep-b'),
       ('is-lead-s', ?, 'عميلة السعودية', '1019300003', 'fb', 'new', 0, 'ONLINE_SAUDI', 'is-rep-b')`, [TENANT, TENANT, TENANT]);
  const thread = (id, key, leadId, staffId, label) => pool.query(
    `INSERT INTO inbox_threads (id, tenant_id, platform, contact_key, lead_id, assigned_staff_id, status, unread_count, last_direction,
        last_inbound_at, last_message_at, last_preview, labels, contact_name)
     VALUES (?,?, 'whatsapp', ?, ?, ?, 'open', 1, 'IN', NOW(), NOW(), 'مرحبا', ?, ?)`,
    [id, TENANT, key, leadId, staffId, label ? JSON.stringify([label]) : null, `${key}-name`]);
  await thread('is-th-a', '201019300001', 'is-lead-a', 'is-rep-a', 'خاص-بسارة');
  await thread('is-th-b', '201019300002', 'is-lead-b', 'is-rep-b', 'خاص-بأحمد');
  await thread('is-th-s', '201019300003', 'is-lead-s', 'is-rep-b', null);
  await thread('is-th-u', '201019399999', null, null, null);
  await pool.query(
    `INSERT INTO communications (id, tenant_id, lead_id, type, direction, thread_id, date, notes) VALUES
       ('is-c-a', ?, 'is-lead-a', 'WHATSAPP', 'IN', 'is-th-a', NOW(), 'رسالة سارة'),
       ('is-c-b', ?, 'is-lead-b', 'WHATSAPP', 'IN', 'is-th-b', NOW(), 'رسالة أحمد')`, [TENANT, TENANT]);
  await pool.query("INSERT INTO inbox_notes (id, tenant_id, thread_id, staff_id, body) VALUES ('is-n-b', ?, 'is-th-b', 'is-rep-b', 'ملاحظة أحمد')", [TENANT]);
  global.fetch = async (url, options = {}) => { sentToMeta.push({ url: String(url), options }); return { ok: true, status: 200, json: async () => ({}) }; };
});
after(async () => { if (ENABLED) { global.fetch = realFetch; await clean(); await pool.end(); setTimeout(() => process.exit(), 300).unref(); } });

test('a rep lists, counts, searches and labels only her own leads\' conversations', { skip }, async () => {
  assert.deepEqual(ids(await call('get', '/api/admin/team-inbox/threads', { as: REP_A, query: { view: 'all' } })), ['is-th-a']);
  assert.deepEqual(ids(await call('get', '/api/admin/team-inbox/threads', { as: REP_B, query: { view: 'all' } })), ['is-th-b', 'is-th-s']);
  // Searching for another rep's client by name, number or label finds nothing.
  for (const query of [{ q: 'عميلة أحمد' }, { q: '1019300002' }, { label: 'خاص-بأحمد' }, { view: 'unassigned' }]) {
    assert.deepEqual(ids(await call('get', '/api/admin/team-inbox/threads', { as: REP_A, query: { view: 'all', ...query } })), [], JSON.stringify(query));
  }
  const counts = await call('get', '/api/admin/team-inbox/counts', { as: REP_A });
  assert.deepEqual([counts.body.mine, counts.body.mineUnread, counts.body.unassigned, counts.body.all], [1, 1, 0, null], 'the badges are hers, not the company\'s');
  const labels = (await call('get', '/api/admin/team-inbox/labels', { as: REP_A })).body.map(row => row.label);
  assert.deepEqual(labels, ['خاص-بسارة'], 'the suggestions are the labels of conversations she may see');
});

test('a rep cannot open, read, reply to, hand over, close, note or label another rep\'s conversation', { skip }, async () => {
  const other = { id: 'is-th-b' };
  const attempts = [
    ['get', '/api/admin/team-inbox/threads/:id'],
    ['get', '/api/admin/team-inbox/threads/:id/contact'],
    ['post', '/api/admin/team-inbox/threads/:id/reply', { text: 'مرحبا' }],
    ['post', '/api/admin/team-inbox/threads/:id/claim'],
    ['post', '/api/admin/team-inbox/threads/:id/assign', { staffId: 'is-rep-a' }],
    ['post', '/api/admin/team-inbox/threads/:id/status', { status: 'closed' }],
    ['post', '/api/admin/team-inbox/threads/:id/notes', { body: 'x' }],
    ['post', '/api/admin/team-inbox/threads/:id/labels', { labels: ['x'] }],
    ['post', '/api/admin/team-inbox/threads/:id/bot', { paused: true }],
  ];
  sentToMeta.length = 0;
  for (const [method, path, body] of attempts) {
    const res = await call(method, path, { as: REP_A, params: other, body });
    assert.equal(res.statusCode, 404, `${method} ${path} answered ${res.statusCode}`);
  }
  assert.equal(sentToMeta.length, 0, 'nothing was sent to the customer');
  const [[row]] = await pool.query("SELECT assigned_staff_id, status, labels FROM inbox_threads WHERE tenant_id=? AND id='is-th-b'", [TENANT]);
  assert.deepEqual({ ...row }, { assigned_staff_id: 'is-rep-b', status: 'open', labels: JSON.stringify(['خاص-بأحمد']) }, 'and nothing on it changed');
  // Her own is open to her.
  const own = await call('get', '/api/admin/team-inbox/threads/:id', { as: REP_A, params: { id: 'is-th-a' } });
  assert.deepEqual([own.statusCode, own.body.messages.map(m => m.text)], [200, ['رسالة سارة']]);
  assert.equal((await call('get', '/api/admin/team-inbox/threads/:id/contact', { as: REP_A, params: { id: 'is-th-a' } })).body.lead.id, 'is-lead-a');
});

test('reply speed and the waiting count are hers, not the team\'s', { skip }, async () => {
  const stats = await call('get', '/api/admin/team-inbox/stats', { as: REP_A, query: { days: 7 } });
  assert.equal(stats.statusCode, 200);
  assert.equal(stats.body.waitingNow, 1, 'one conversation waiting on her, not the company\'s three');
  assert.equal(stats.body.newConversations, 1);
});

test('the manager sees every conversation, the unlinked one included, with the company\'s counts', { skip }, async () => {
  assert.deepEqual(ids(await call('get', '/api/admin/team-inbox/threads', { as: MANAGER, query: { view: 'all' } })), ['is-th-a', 'is-th-b', 'is-th-s', 'is-th-u']);
  assert.equal((await call('get', '/api/admin/team-inbox/counts', { as: MANAGER })).body.all, 4);
  assert.equal((await call('get', '/api/admin/team-inbox/threads/:id', { as: MANAGER, params: { id: 'is-th-b' } })).statusCode, 200);
  assert.equal((await call('get', '/api/admin/team-inbox/stats', { as: MANAGER })).body.waitingNow, 4);
});

test('a branch-scoped role sees its branch\'s conversations, and no other', { skip }, async () => {
  assert.deepEqual(ids(await call('get', '/api/admin/team-inbox/threads', { as: BRANCH, query: { view: 'all' } })), ['is-th-s']);
  assert.equal((await call('get', '/api/admin/team-inbox/threads/:id', { as: BRANCH, params: { id: 'is-th-s' } })).statusCode, 200, 'another rep\'s, but in her branch');
  assert.equal((await call('get', '/api/admin/team-inbox/threads/:id', { as: BRANCH, params: { id: 'is-th-a' } })).statusCode, 404, 'another branch');
});

test('a conversation linked to no lead is for the people who see everything and the staff the settings name — nobody else', { skip }, async () => {
  for (const rep of [REP_A, REP_B]) {
    assert.deepEqual(ids(await call('get', '/api/admin/team-inbox/threads', { as: rep, query: { view: 'unassigned' } })), []);
    assert.equal((await call('get', '/api/admin/team-inbox/threads/:id', { as: rep, params: { id: 'is-th-u' } })).statusCode, 404);
    assert.equal((await call('post', '/api/admin/team-inbox/threads/:id/claim', { as: rep, params: { id: 'is-th-u' } })).statusCode, 404);
  }
  const triager = { id: 'is-triager', name: 'is-triager', role: 'sales', data_scope: null };
  assert.deepEqual(ids(await call('get', '/api/admin/team-inbox/threads', { as: triager, query: { view: 'unassigned' } })), []);
  const saved = await call('put', '/api/admin/team-inbox/settings', { as: MANAGER, body: { triageStaffIds: ['is-triager'], distributeWaiting: false } });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.settings.triageStaffIds, ['is-triager']);
  assert.deepEqual(ids(await call('get', '/api/admin/team-inbox/threads', { as: triager, query: { view: 'unassigned' } })), ['is-th-u']);
  assert.deepEqual(ids(await call('get', '/api/admin/team-inbox/threads', { as: REP_A, query: { view: 'unassigned' } })), [], 'a rep who is not named still sees nothing of it');
  assert.equal((await call('put', '/api/admin/team-inbox/settings', { as: REP_A, body: { triageStaffIds: ['is-rep-a'] } })).statusCode, 403, 'only the managers name the triagers');
});

test('a new message notifies the people who may see the conversation and nobody else', { skip }, async () => {
  const { notifyInbox } = require('../../lib/inboxAccess');
  const recipients = async thread => {
    await pool.query('DELETE FROM notifications WHERE tenant_id=?', [TENANT]);
    await notifyInbox({ type: 'whatsapp', title: 't', message: 'm', data: {}, tenantId: TENANT, thread });
    const [rows] = await pool.query('SELECT recipient_staff_id FROM notifications WHERE tenant_id=?', [TENANT]);
    return rows.map(row => row.recipient_staff_id).sort();
  };
  assert.deepEqual(await recipients({ assignedStaffId: 'is-rep-b' }), ['is-rep-b'], 'the rep who has the conversation');
  assert.deepEqual(await recipients({ leadId: 'is-lead-b' }), ['is-rep-b'], 'the rep who owns the lead — not rep A, not a broadcast');
  assert.deepEqual(await recipients({}), ['is-boss', 'is-triager'], 'an unlinked conversation: the manager and the named triager — not the reps');

  // The real inbound path: a customer writes to the company number from a lead of rep B.
  await pool.query('DELETE FROM notifications WHERE tenant_id=?', [TENANT]);
  await require('../../lib/whatsappInbound').recordInboundMessage({
    tenantId: TENANT, providerMessageId: 'is-wa-1', from: '201019300002', body: 'عايزة أسأل', timestamp: Math.floor(Date.now() / 1000),
  });
  const [rows] = await pool.query("SELECT recipient_staff_id FROM notifications WHERE tenant_id=? AND type='whatsapp'", [TENANT]);
  assert.deepEqual(rows.map(row => row.recipient_staff_id), ['is-rep-b']);
});
