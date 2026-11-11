'use strict';
// The refund desk (routes/finance/refunds.js) through its real guards and handlers on a recording database: who may read, decide, escalate,
// confirm payout and archive a refund request; that a decision cannot exceed the amount asked for, needs its reason, is made once, and never
// leaves the caller's data scope; and that every statement carries the tenant.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/finance/refunds');
after(() => setTimeout(() => process.exit(), 300).unref());

const perms = (...list) => JSON.stringify(list);
const ACCOUNTS = { id: 'st-acc', role: 'ACCOUNTANT', data_scope: 'all', name: 'Acc', permissions_json: perms('view_financial', 'approve_refunds') };
const SUPPORT = { id: 'st-cs', role: 'SUPPORT', data_scope: 'all', name: 'CS', permissions_json: perms('manage_inbox') };
const DAQQI = { ...ACCOUNTS, id: 'st-dokki', data_scope: 'branch:DAQQI' };

const LIST = '/api/admin/finance/refunds';
const ONE = '/api/admin/finance/refunds/:id';
const ESCALATE = '/api/admin/finance/refunds/:id/escalate';
const BLAME = '/api/admin/finance/refunds/:id/blame';
const PAID_OUT = '/api/admin/finance/refunds/:id/mark-refunded';

const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
const answerWith = rules => { h.state.answer = sql => { for (const [pattern, rows] of rules) if (pattern.test(sql)) return rows; return undefined; }; };
const wrote = () => statements(/^(INSERT|UPDATE|DELETE)/);
const request = (over = {}) => ({ id: 'rf-1', status: 'PENDING', amount: '1000.00', currency: 'EGP', payment_id: 'pay-1', course_item: null, subscriber_id: 'sub-1', branch_id: 'branch-daqqi', assigned_cs_id: null, assigned_sales_id: null, ...over });
const decide = (as, body, id = 'rf-1') => run(router, 'PUT', ONE, { as, params: { id }, body, harness: h });
test.beforeEach(() => { h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; answerWith([]); });

test('who may use the refund desk: reading and escalating are open to customer service, deciding and confirming payout are not', async () => {
  for (const [method, path] of [['GET', LIST], ['PUT', ONE], ['POST', ESCALATE], ['POST', BLAME], ['POST', PAID_OUT], ['DELETE', ONE]]) {
    assert.equal((await run(router, method, path, { as: 'anonymous', params: { id: 'rf-1' }, body: {}, harness: h })).status, 401, `${method} ${path}`);
    assert.equal((await run(router, method, path, { as: 'client', params: { id: 'rf-1' }, body: {}, harness: h })).status, 403, `${method} ${path} client`);
  }
  assert.equal((await run(router, 'GET', LIST, { as: SUPPORT, harness: h })).status, 200);
  assert.equal((await run(router, 'POST', ESCALATE, { as: SUPPORT, params: { id: 'rf-1' }, body: { note: 'urgent' }, harness: h })).status, 200);
  for (const [method, path, body] of [['PUT', ONE, { status: 'APPROVED' }], ['POST', PAID_OUT, {}]]) {
    const res = await run(router, method, path, { as: SUPPORT, params: { id: 'rf-1' }, body, harness: h });
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.match(res.body.error, /approve_refunds/);
  }
  // Blaming a colleague and archiving are administrators', not the accountant's.
  assert.equal((await run(router, 'POST', BLAME, { as: ACCOUNTS, params: { id: 'rf-1' }, body: { staff_id: 'x' }, harness: h })).status, 403);
  assert.equal((await run(router, 'DELETE', ONE, { as: ACCOUNTS, params: { id: 'rf-1' }, harness: h })).status, 403);
});

test('the list is read inside the tenant and the branch scope, and its contact count and ticket flag are numbers', async () => {
  answerWith([[/FROM refund_requests rr/, [{ id: 'rf-1', amount: '10', last_contact: '{"channel":"phone"}', contacts_count: '2', has_ticket_history: '1', ticket_history: '[...]' }]]]);
  const res = await run(router, 'GET', LIST, { as: DAQQI, harness: h });
  assert.equal(res.status, 200);
  assert.ok(h.calls[0].params.includes(TENANT) && h.calls[0].params.includes('branch-daqqi'));
  assert.match(h.calls[0].sql, /rr\.deleted_at IS NULL/);
  assert.deepEqual(res.body[0].last_contact, { channel: 'phone' });
  assert.strictEqual(res.body[0].contacts_count, 2);
  assert.strictEqual(res.body[0].has_ticket_history, true);
  assert.equal('ticket_history' in res.body[0], false, 'the whole history is not shipped for every row');

  const other = await run(router, 'GET', LIST, { as: DAQQI, query: { branch: 'TAGAMOA' }, harness: h });
  assert.ok(other.status >= 400 && other.status < 500, 'another branch than the caller\'s is refused');
});

test('a decision names APPROVED, REJECTED or HANDLING, and a rejection or a handling says why', async () => {
  assert.equal((await decide(ACCOUNTS, { status: 'DONE' })).status, 400);
  assert.equal((await decide(ACCOUNTS, {})).status, 400);
  const noWhy = await decide(ACCOUNTS, { status: 'rejected', decision_note: '   ' });
  assert.equal(noWhy.status, 400);
  assert.match(noWhy.body.error, /سبب الرفض/);
  assert.equal((await decide(ACCOUNTS, { status: 'HANDLING' })).status, 400);
  assert.equal(h.calls.length, 0, 'refused before any row is read');
});

test('a decision on a request that is missing, outside the caller\'s branch, or already resolved changes nothing', async () => {
  answerWith([[/FROM refund_requests rr/, []]]);
  assert.equal((await decide(ACCOUNTS, { status: 'REJECTED', decision_note: 'no' })).status, 404);
  assert.deepEqual(h.calls[0].params, ['rf-1', TENANT]);
  assert.match(h.calls[0].sql, /FOR UPDATE/);

  answerWith([[/FROM refund_requests rr/, [request({ branch_id: 'branch-tagamoa' })]]]);
  assert.equal((await decide(DAQQI, { status: 'REJECTED', decision_note: 'no' })).status, 404, 'a branch accountant cannot decide another branch\'s refund');

  answerWith([[/FROM refund_requests rr/, [request({ status: 'APPROVED' })]]]);
  assert.equal((await decide(ACCOUNTS, { status: 'REJECTED', decision_note: 'no' })).status, 409);

  assert.equal(wrote().length, 0);
  assert.ok(h.state.transactions.includes('rollback'));
});

test('an approval is refused without a payment or course behind it, and for an amount that is zero, negative, text or more than was asked', async () => {
  answerWith([[/FROM refund_requests rr/, [request({ payment_id: null, course_item: null })]]]);
  const unlinked = await decide(ACCOUNTS, { status: 'APPROVED' });
  assert.equal(unlinked.status, 409);

  answerWith([[/FROM refund_requests rr/, [request({ amount: '1000.00' })]]]);
  for (const refunded_amount of [0, -5, 'abc', 1000.01, '2000']) {
    const res = await decide(ACCOUNTS, { status: 'APPROVED', refunded_amount });
    assert.equal(res.status, 400, `refunded_amount ${refunded_amount}`);
  }
  assert.equal(statements(/UPDATE refund_requests/).length, 0, 'nothing is written for any of them');
  assert.equal(statements(/INSERT INTO payments/).length, 0);
});

test('a rejection is stored with its reason, the amount stays empty, no money moves, and the decision is audited', async () => {
  answerWith([[/FROM refund_requests rr/, [request()]]]);
  const res = await decide(ACCOUNTS, { status: 'rejected', decision_note: '  outside the 14 day window  ', notes: 'checked' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const update = statements(/UPDATE refund_requests\s+SET status=\?/)[0];
  assert.deepEqual(update.params, ['REJECTED', 'checked', 'outside the 14 day window', null, 'st-acc', 'rf-1', TENANT]);
  assert.equal(statements(/INSERT INTO payments|UPDATE payments/).length, 0, 'a rejected refund returns no money');
  assert.ok(statements(/audit/i).length >= 1, 'a financial audit row is written');
  assert.deepEqual(h.state.transactions.filter(t => t !== 'release'), ['begin', 'commit']);
});

test('escalating needs an existing request in the tenant, records who raised it, and the note is bounded', async () => {
  h.state.answer = () => ({ affectedRows: 0 });
  assert.equal((await run(router, 'POST', ESCALATE, { as: SUPPORT, params: { id: 'rf-x' }, body: {}, harness: h })).status, 404);
  const update = statements(/UPDATE refund_requests/)[0];
  assert.deepEqual([update.params[0], update.params[2], update.params[3]], ['st-cs', 'rf-x', TENANT]);
  assert.match(update.params[1], /بدون ملاحظة/);
  h.calls.length = 0;
  h.state.answer = () => undefined;
  await run(router, 'POST', ESCALATE, { as: SUPPORT, params: { id: 'rf-1' }, body: { note: 'x'.repeat(5000) }, harness: h });
  assert.ok(statements(/UPDATE refund_requests/)[0].params[1].length <= 2000 + 30);
});

test('the payout is confirmed once, only after approval, and inside the caller\'s scope', async () => {
  const confirm = as => run(router, 'POST', PAID_OUT, { as, params: { id: 'rf-1' }, body: {}, harness: h });
  answerWith([[/SELECT rr\.status/, []]]);
  assert.equal((await confirm(ACCOUNTS)).status, 404);

  answerWith([[/SELECT rr\.status/, [{ status: 'PENDING', branch_id: 'branch-daqqi' }]]]);
  assert.equal((await confirm(ACCOUNTS)).status, 409, 'money cannot have left before the request was approved');

  answerWith([[/SELECT rr\.status/, [{ status: 'APPROVED', branch_id: 'branch-tagamoa' }]]]);
  assert.equal((await confirm(DAQQI)).status, 404);
  assert.equal(statements(/SET status='REFUNDED'/).length, 0);

  answerWith([[/SELECT rr\.status/, [{ status: 'APPROVED', branch_id: 'branch-daqqi' }]], [/SET status='REFUNDED'/, { affectedRows: 0 }]]);
  assert.equal((await confirm(ACCOUNTS)).status, 409, 'a second click while the first is writing');

  answerWith([[/SELECT rr\.status/, [{ status: 'APPROVED', branch_id: 'branch-daqqi' }]]]);
  assert.equal((await confirm(ACCOUNTS)).status, 200);
  const done = statements(/SET status='REFUNDED'/)[0];
  assert.match(done.sql, /status='APPROVED'/, 'the update itself re-checks the status');
  assert.deepEqual(done.params, ['rf-1', TENANT]);
});

test('blaming a colleague needs the colleague to be staff of the tenant; an empty id clears the blame; archiving is soft and 404 when nothing matched', async () => {
  const blame = body => run(router, 'POST', BLAME, { as: 'owner', params: { id: 'rf-1' }, body, harness: h });
  answerWith([[/FROM staff WHERE id=\?/, []]]);
  assert.equal((await blame({ staff_id: 'st-x' })).status, 404);
  assert.deepEqual(statements(/FROM staff WHERE id=\?/)[0].params, ['st-x', TENANT]);
  assert.equal(statements(/SET blamed_staff_id=\?/).length, 0);

  answerWith([[/FROM staff WHERE id=\?/, [{ id: 'st-x', name: 'Mona' }]]]);
  const ok = await blame({ staff_id: 'st-x', note: 'gave wrong price' });
  assert.equal(ok.status, 200);
  assert.match(ok.body.message, /Mona/);
  assert.deepEqual(statements(/SET blamed_staff_id=\?/)[0].params, ['st-x', 'gave wrong price', 'rf-1', TENANT]);

  h.calls.length = 0;
  assert.equal((await blame({ staff_id: '' })).status, 200);
  assert.match(statements(/blamed_staff_id=NULL/)[0].sql, /blame_note=NULL/);

  h.calls.length = 0;
  h.state.answer = () => ({ affectedRows: 0 });
  assert.equal((await run(router, 'DELETE', ONE, { as: 'owner', params: { id: 'nope' }, harness: h })).status, 404);
  h.state.answer = () => undefined;
  assert.equal((await run(router, 'DELETE', ONE, { as: 'owner', params: { id: 'rf-1' }, harness: h })).status, 200);
  const archived = statements(/SET deleted_at=NOW\(\)/).at(-1);
  assert.deepEqual(archived.params, ['rf-1', TENANT]);
  assert.equal(statements(/DELETE FROM refund_requests/).length, 0, 'a money decision keeps its trail');
});
