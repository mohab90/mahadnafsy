'use strict';

// «زر فتح تيكت مشكله للعميل بدون ما ننقل العميل من مكانه … يروح لخدمه العملاء
// نشوف مشكلته ونسمعها» (8 Oct 2026): the ticket goes to customer service, and
// the problem and how it was solved are written on the client's file.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-problem-ticket-secret-0123456789-abcdefghij';

const writes = [];
let ticket = null;
const query = async (sql, params = []) => {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  if (/^SELECT id,email,name FROM subscribers/.test(flat)) return [[{ id: 's-1', email: 'c@example.com', name: 'ياسمين محمد' }]];
  if (/FROM staff/.test(flat)) return [[{ id: 'st-cs', name: 'منى' }]];
  if (/^SELECT id FROM subscribers WHERE tenant_id=\? AND deleted_at IS NULL AND REGEXP_REPLACE/.test(flat)) return [[{ id: 's-1' }]];
  if (/^SELECT status,department,assigned_to,subject,subscriber_id/.test(flat)) return [[ticket]];
  if (/FROM ticket_replies WHERE ticket_id=\? AND tenant_id=\? AND author_type='STAFF'/.test(flat)) return [[{ body: 'اتكلمنا معاها واتنقلت لمحاضر تاني' }]];
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
stub('../lib/outbox', { enqueue: async () => {} });

const router = require('../routes/support');
const handlerOf = (method, route) => router.stack.find(l => l.route && l.route.path === route && l.route.methods[method]).route.stack.slice(-1)[0].handle;
async function call(method, route, req) {
  writes.length = 0;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handlerOf(method, route)({ tenantId: 't', user: { uid: 'u' }, staffRecord: { id: 'st-d', name: 'هنا', role: 'reception_daqqi' }, ...req }, res);
  return res;
}
const historyOf = () => writes.filter(w => /^INSERT INTO activity_logs/.test(w.sql)).map(w => ({ action: w.params[2], subscriber: w.params[4], label: w.params[5], actor: w.params[6] }));

test('«فتح تيكت مشكلة» goes to customer service and is written on the client\'s file', async () => {
  const res = await call('post', '/api/admin/cs/tickets', { body: { subscriber_id: 's-1', subject: 'مش راضية عن المحاضر', body: 'بتقول الشرح سريع', category: 'client_problem', channel: 'internal' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.department, 'support', 'customer service\'s queue');
  assert.equal(res.body.priority, 'high');
  const [entry] = historyOf();
  assert.equal(entry.action, 'problem_ticket_opened');
  assert.equal(entry.subscriber, 's-1');
  assert.equal(entry.actor, 'هنا', 'by name, never the email');
  assert.match(entry.label, /الدعم الفني \(منى\): «مش راضية عن المحاضر» — بتقول الشرح سريع/);
  assert.ok(!writes.some(w => /UPDATE subscribers/.test(w.sql)), 'the client is not moved');
});

test('resolving it writes the resolution on the ticket and on the client\'s file', async () => {
  ticket = { status: 'in_progress', department: 'support', assigned_to: 'st-cs', subject: 'مش راضية عن المحاضر', subscriber_id: 's-1', subscriber_email: null };
  const res = await call('put', '/api/admin/tickets/:id/status', { params: { id: 'tk-1' }, staffRecord: { id: 'st-cs', name: 'منى', role: 'support' }, body: { status: 'resolved' } });
  assert.equal(res.statusCode, 200);
  const note = writes.find(w => /SET resolution_note=\?/.test(w.sql));
  assert.equal(note.params[0], 'اتكلمنا معاها واتنقلت لمحاضر تاني', 'the last answer, when no reason was typed');
  const [entry] = historyOf();
  assert.equal(entry.action, 'problem_ticket_resolved');
  assert.match(entry.label, /اتحلت المشكلة «مش راضية عن المحاضر» — الحل: اتكلمنا معاها/);
});

test('the transfer menu offers it, Dokki and online alike', () => {
  const modal = fs.readFileSync(path.join(__dirname, '../../admin/pages/dashboard/tabs/OnlineClientConvertModal.tsx'), 'utf8');
  assert.match(modal, /key: 'ticket' as const, label: '🎫 مشكلة أو شكوى/);
  assert.match(modal, /<ProblemTicketForm subscriberId=\{row\.id\}/);
  const form = fs.readFileSync(path.join(__dirname, '../../admin/pages/dashboard/tabs/ProblemTicketForm.tsx'), 'utf8');
  // A complaint goes to the administration (9 Oct 2026).
  assert.match(form, /category: to === 'management' \? 'complaint' : 'client_problem'/);
  const { CATEGORY_META } = require('../lib/ticketRouting');
  assert.equal(CATEGORY_META.complaint.department, 'management');
});

test('a call taken by phone finds the client by the number', async () => {
  const res = await call('post', '/api/admin/cs/tickets', { body: { phone: '0100 123 4567', name: 'ياسمين', subject: 'الفيديو مش بيفتح', body: 'من امبارح' } });
  assert.equal(res.statusCode, 200);
  const [entry] = historyOf();
  assert.equal(entry.subscriber, 's-1', 'the ticket and its fix land on her file');
});

test('one page: the inbox carries what the old tickets screen showed', async () => {
  const seen = [];
  const original = require('../lib/db').pool.query;
  require('../lib/db').pool.query = async (sql, params) => { seen.push(String(sql).replace(/\s+/g, ' ')); return original(sql, params); };
  try {
    await call('get', '/api/admin/cs/inbox', { query: {}, isSuperAdmin: true });
  } finally { require('../lib/db').pool.query = original; }
  const list = seen.find(sql => /FROM support_tickets t/.test(sql));
  assert.match(list, /LEFT\(t\.body, 400\) AS body, t\.resolution_note, t\.subscriber_id/);
  assert.match(list, /sb\.phone AS subscriber_phone, sb\.client_code/);
  assert.match(list, /\(t\.department IN \('support','management'\) OR t\.escalated_at IS NOT NULL\)/, 'complaints and what was escalated stay in view');
});
