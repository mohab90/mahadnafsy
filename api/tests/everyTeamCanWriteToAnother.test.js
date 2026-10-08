'use strict';

// «في نظام المراسله محتاج كل فريق يقدر يبعت للفريق التاني يعني اقدر ابعت للدقي
// فقط او خدمه العملاء فقط او فريق الاونلاين فقط او الادارة فقط او لمدير محدد او
// للفريق كله» (8 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-team-messages-secret-0123456789-abcdefghijk';

const STAFF = [
  { id: 'st-sama', name: 'سما', role: 'SALES', branch_id: 'branch-other' },
  { id: 'st-rana', name: 'رنا', role: 'SALES', branch_id: 'branch-other' },
  { id: 'st-dm', name: 'مدير الدقي', role: 'DAQQI_MANAGER', branch_id: 'branch-daqqi' },
  { id: 'st-rec', name: 'ريسبشن', role: 'RECEPTION_DAQQI', branch_id: 'branch-other' },
  { id: 'st-cs', name: 'خدمة', role: 'SUPPORT', branch_id: 'branch-other' },
  { id: 'st-col', name: 'تحصيل', role: 'COLLECTION', branch_id: 'branch-other' },
  { id: 'st-mgr', name: 'أ. هالة', role: 'MANAGER', branch_id: 'branch-other' },
];
const inserted = [];
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
const query = async (sql, params = []) => {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  if (/^INSERT INTO staff_messages/.test(flat)) {
    // The sender's own copy names its direction in the SQL; the fan-out, per row.
    if (/'from_staff'/.test(flat)) inserted.push({ staffId: params[2], direction: 'from_staff', label: params[6] });
    else for (let i = 0; i < params.length; i += 9) inserted.push({ staffId: params[i + 2], direction: params[i + 5], label: params[i + 7] });
    return [{ affectedRows: 1 }];
  }
  if (/SELECT UPPER\(role\) role FROM staff WHERE id=\?/.test(flat)) return [[{ role: STAFF.find(p => p.id === params[0]).role }]];
  if (/SELECT id, name, UPPER\(role\) role, branch_id FROM staff/.test(flat)) return [STAFF];
  if (/SELECT author_staff_id FROM staff_messages/.test(flat)) return [[params[0] === 'msg-from-dm' ? { author_staff_id: 'st-dm' } : undefined]];
  if (/SELECT id, name FROM staff WHERE/.test(flat)) {
    const me = /id<>\?/.test(flat) ? params[/AND id=\?/.test(flat) ? 2 : 1] : null;
    let rows = STAFF.filter(p => p.id !== me);
    if (/UPPER\(role\)=\?/.test(flat)) rows = rows.filter(p => p.role === params[1]);
    if (/AND \(UPPER\(role\) IN \(\?\)/.test(flat)) {
      const roles = params[2]; const branch = params[3];
      rows = rows.filter(p => roles.includes(p.role) || (branch && p.branch_id === branch));
    }
    if (/AND id=\? AND id<>\? AND UPPER\(role\) IN \(\?\)/.test(flat)) rows = STAFF.filter(p => p.id === params[1] && p.id !== params[2] && params[3].includes(p.role));
    else if (/AND id=\? LIMIT 1/.test(flat)) rows = STAFF.filter(p => p.id === params[1]);
    return [rows.map(({ id, name }) => ({ id, name }))];
  }
  return [[]];
};
stub('../lib/db', {
  pool: { query, execute: query, getConnection: async () => ({ query, release() {} }) },
  cached: async (_k, _t, fn) => fn(), cacheInvalidate() {}, requireDb: (_q, _s, n) => n(), isDbDown: () => false,
  getStaffIdByEmail: async () => null,
});
stub('../lib/notification', { createNotification: async () => {} });
const shared = require('../routes/hr/_shared');
shared._resolveStaffByUser = async () => STAFF[0];
shared.createNotification = async () => {};
const router = require('../routes/hr/staffprofile');
const handlerOf = (method, path) => router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]).route.stack.slice(-1)[0].handle;

async function send(scope) {
  inserted.length = 0;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handlerOf('post', '/api/staff/me/messages')({ body: { body: 'مرحبا', scope }, tenantId: 'tenant-default', user: { uid: 'u' } }, res);
  return { res, to: inserted.filter(row => row.direction === 'peer_broadcast').map(row => row.staffId).sort() };
}

test('a rep writes to the Dokki team — its roles and everyone placed at the branch', async () => {
  const { res, to } = await send('team:daqqi');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(to, ['st-dm', 'st-rec']);
  assert.equal(res.body.label, 'فريق الدقي');
  assert.ok(inserted.some(row => row.staffId === 'st-sama' && row.direction === 'from_staff'), 'the sender keeps a copy');
});

test('customer service only, the online team only, one manager, everyone', async () => {
  assert.deepEqual((await send('team:support')).to, ['st-cs']);
  assert.deepEqual((await send('team:online')).to, ['st-col']);
  assert.deepEqual((await send('manager:st-mgr')).to, ['st-mgr']);
  assert.equal((await send('manager:st-rana')).res.statusCode, 400, 'a rep is not a manager');
  assert.deepEqual((await send('all')).to, ['st-col', 'st-cs', 'st-dm', 'st-mgr', 'st-rana', 'st-rec']);
});

test('a reply goes to whoever wrote, and only from one\'s own thread', async () => {
  assert.deepEqual((await send('reply:msg-from-dm')).to, ['st-dm']);
  assert.equal((await send('reply:someone-elses')).res.statusCode, 400);
  assert.equal((await send('team:nowhere')).res.statusCode, 400);
});

test('the composer is offered the teams that have someone, and the managers', async () => {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handlerOf('get', '/api/staff/me/messages/targets')({ tenantId: 'tenant-default', user: { uid: 'u' } }, res);
  assert.deepEqual(res.body.teams.map(team => [team.scope, team.count]), [
    ['team:sales', 1], ['team:online', 1], ['team:support', 1], ['team:daqqi', 2],
  ]);
  assert.deepEqual(res.body.managers.map(manager => manager.scope).sort(), ['manager:st-dm', 'manager:st-mgr']);
  assert.equal(res.body.everyone, 6);
});
