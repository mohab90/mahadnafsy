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
  const res = await call('post', '/api/admin/cs/tickets', { body: { subscriber_id: 's-1', subject: 'مش راضية عن المحاضر', body: 'بتقول الشرح سريع', category: 'client_problem', priority: 'medium', channel: 'internal' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.department, 'support', 'customer service\'s queue');
  assert.equal(res.body.priority, 'medium', 'the priority the sender chose');
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
  assert.match(list, /\(t\.department IN \('support','management'\) OR t\.escalated_at IS NOT NULL OR t\.channel IN \(\?,\?,\?,\?\)\)/, 'complaints, what was escalated, and everything from the website stay in view');
  // «تبع فرع ايه … مين المسئول في الفرع اللى رفعتها» (10 Oct 2026).
  assert.match(list, /COALESCE\(t\.branch, sb\.branch\) AS branch/);
  assert.match(list, /COALESCE\(t\.created_by_name, \(SELECT te\.actor_name FROM ticket_events te/);
});

test('a problem passed on from a client\'s row must carry the priority its sender chose', async () => {
  const res = await call('post', '/api/admin/cs/tickets', { body: { subscriber_id: 's-1', subject: 'شكوى', body: 'تفاصيل', category: 'complaint', channel: 'internal' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'PRIORITY_REQUIRED');
  assert.ok(!writes.some(w => /^INSERT INTO support_tickets/.test(w.sql)), 'nothing is made up for it');
  const form = fs.readFileSync(path.join(__dirname, '../../admin/pages/dashboard/tabs/ProblemTicketForm.tsx'), 'utf8');
  assert.match(form, /priority,/);
  assert.match(form, /disabled=\{sending \|\| !body\.trim\(\) \|\| !priority\}/);
});

test('customer-service problems are never handed to the managers', () => {
  const { DEPARTMENT_ROLES } = require('../lib/ticketRouting');
  for (const dept of ['support', 'collection', 'accounting', 'sales']) {
    assert.ok(!DEPARTMENT_ROLES[dept].some(role => /manager|admin/.test(role)), `${dept}: ${DEPARTMENT_ROLES[dept]}`);
  }
});

const CS = { id: 'st-cs', name: 'منى', role: 'support' };
test('every contact with the client is written on the ticket and on the client\'s file, with the cause and the next step', async () => {
  ticket = { id: 'tk-1', status: 'open', department: 'support', assigned_to: 'st-cs', subject: 'مش راضية عن المحاضر', subscriber_id: 's-1' };
  const call2 = body => call('post', '/api/admin/tickets/:id/contact', { params: { id: 'tk-1' }, staffRecord: CS, body });
  assert.equal((await call2({ channel: 'whatsapp', said: ' ' })).statusCode, 400, 'what was said is the point');
  assert.equal((await call2({ channel: 'pigeon', said: 'x' })).statusCode, 400);
  const noCause = await call2({ channel: 'call', outcome: 'answered', said: 'x', next: 'resolved' });
  assert.equal(noCause.body.code, 'CONTACT_CAUSE_REQUIRED', 'a client who was reached: the real cause is asked');
  const noNext = await call2({ channel: 'call', outcome: 'answered', said: 'x', cause: 'y' });
  assert.equal(noNext.body.code, 'CONTACT_NEXT_REQUIRED', 'and what happens next');
  const noDate = await call2({ channel: 'call', outcome: 'answered', said: 'x', cause: 'y', next: 'follow_up' });
  assert.equal(noDate.body.code, 'CONTACT_DATE_REQUIRED');
  const res = await call2({ channel: 'call', outcome: 'answered', said: 'وعدتها بمحاضر تاني من الأسبوع الجاي', cause: 'المحاضر اتغيّر من غير إبلاغ', next: 'follow_up', nextDate: '2026-10-20' });
  assert.equal(res.statusCode, 200);
  assert.ok(writes.some(w => /first_response_at = COALESCE\(first_response_at, NOW\(\)\)/.test(w.sql)), 'the first contact is the first response');
  const update = writes.find(w => /root_cause = COALESCE/.test(w.sql));
  assert.deepEqual([update.params[0], update.params[1]], ['المحاضر اتغيّر من غير إبلاغ', '2026-10-20'], 'the cause and the next contact are kept on the ticket');
  const event = writes.find(w => /^INSERT INTO ticket_events/.test(w.sql));
  assert.ok(event.params.includes('contacted') && event.params.some(v => String(v).includes('السبب الحقيقي: المحاضر اتغيّر')));
  const [entry] = historyOf();
  assert.equal(entry.action, 'problem_ticket_contacted');
  assert.match(entry.label, /اتصال — رد.*وعدتها بمحاضر تاني/);
  // Not reached: only another attempt is left, so no cause and no choice are asked.
  const missed = await call2({ channel: 'call', outcome: 'no_answer', said: 'اتصلت مرتين', nextDate: '2026-10-16' });
  assert.equal(missed.statusCode, 200);
  assert.equal(missed.body.next, 'follow_up');
});

test('the contact form offers the four next steps and each is carried out', () => {
  const form = fs.readFileSync(path.join(__dirname, '../../admin/pages/dashboard/tabs/TicketContact.tsx'), 'utf8');
  for (const label of ['المشكلة انتهت', 'لسه في تواصل تاني', 'يرجع للإدارة', 'هيسترد']) assert.ok(form.includes(label), label);
  assert.match(form, /status`, \{ status: 'resolved', closed_reason: summary \}/);
  assert.match(form, /escalate`, \{ reason: summary, kind \}/);
  assert.match(form, /route`, \{ category: 'refund' \}/);
  // A client with no number still has a way in.
  assert.match(form, /ضيف رقم العميل/);
  assert.match(form, /mailto:/);
});
