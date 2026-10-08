'use strict';

// The Dokki review (9 Oct 2026): eleven rounds running since August held four
// attendance marks between them. The «حضور» button names no session, so the
// server marked daqqi_rounds.current_lecture — which nothing ever moved past 1 —
// and from the second week every tap answered «already recorded».

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-attendance-secret-0123456789-abcdefghijklmn';

const DAY = 86400000;
const writes = [];
let round;
let marked;
const query = async (sql, params = []) => {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  if (/^SELECT id,status,current_lecture,start_date,postponed_weeks_json FROM daqqi_rounds/.test(flat)) return [[round]];
  if (/^SELECT branch FROM daqqi_rounds/.test(flat)) return [[{ branch: 'DAQQI' }]];
  if (/^SELECT attended_lectures FROM daqqi_attendees/.test(flat)) return [[{ attended_lectures: marked.length }]];
  if (/FROM daqqi_attendance_events WHERE tenant_id=\? AND round_id=\? AND subscriber_id=\?/.test(flat)) {
    return [[{ total: marked.length, this_session: marked.filter(n => n === params[0]).length }]];
  }
  if (/^(INSERT|UPDATE)/.test(flat)) { writes.push({ sql: flat, params }); return [{ affectedRows: 1 }]; }
  return [[]];
};
const conn = { query, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query, execute: query, getConnection: async () => conn },
  cached: async (_k, _t, fn) => fn(), cacheInvalidate() {}, requireDb: (_q, _s, n) => n(), isDbDown: () => false,
  getStaffIdByEmail: async () => null,
});
stub('../lib/auditTrail', { writeAuditEvent: async () => {} });
stub('../lib/selfRating', { inviteToRate: async () => 0 });

const router = require('../routes/daqqi-rounds');
const layer = router.stack.find(l => l.route && l.route.path === '/api/admin/daqqi-rounds/:roundId/attendance' && l.route.methods.post);
const handler = layer.route.stack.slice(-1)[0].handle;
async function mark() {
  writes.length = 0;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { roundId: 'r-1' }, tenantId: 't', body: { subscriberId: 's-1' }, user: { uid: 'u' }, staffRecord: { id: 'st', role: 'reception_daqqi' } }, res);
  return res;
}

test('the button marks the lecture the round is on by its dates, week after week', async () => {
  // Started 22 days ago, lecture 1 marked in its first week: today is lecture 4.
  round = { id: 'r-1', status: 'ACTIVE', current_lecture: 1, start_date: new Date(Date.now() - 22 * DAY), postponed_weeks_json: '[]' };
  marked = [1];
  const res = await mark();
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.sessionNumber, 4);
  assert.ok(writes.some(w => /^UPDATE daqqi_rounds SET current_lecture=\?/.test(w.sql) && w.params[0] === 4), 'the round moves on with it');
  assert.ok(writes.some(w => /^INSERT INTO daqqi_attendance_events/.test(w.sql) && w.params[4] === 4));
});

test('a postponed week is not a lecture', async () => {
  round = { id: 'r-1', status: 'ACTIVE', current_lecture: 1, start_date: new Date(Date.now() - 22 * DAY), postponed_weeks_json: '["2026-09-28"]' };
  marked = [];
  const res = await mark();
  assert.equal(res.body.sessionNumber, 3);
});

test('marking the same lecture twice is still refused', async () => {
  round = { id: 'r-1', status: 'ACTIVE', current_lecture: 4, start_date: new Date(Date.now() - 22 * DAY), postponed_weeks_json: '[]' };
  marked = [4];
  assert.equal((await mark()).statusCode, 409);
});
