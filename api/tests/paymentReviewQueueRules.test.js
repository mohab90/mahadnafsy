'use strict';
// 12 Nov 2026, the owner on the payments waiting for review: «انا محتاج اللي فيه قبول ورفض وربط وتعديل … مينفعش يعمل حجز بتاريخ لسه مجاش،
// ينفع يكون بتاريخ قديم لكن لسه مجاش لا». The real routes on a recording database: a new client's request is accepted under the same rule as
// any payment, can be corrected while it waits, and nothing is dated ahead.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/subscriber-payments');
const installments = require('../routes/installments');
const { cairoToday, addDaysToDateOnly } = require('../lib/dates');
after(() => setTimeout(() => process.exit(), 300).unref());

const perms = (...list) => JSON.stringify(list);
const ACCOUNTANT = { id: 'st-acc', role: 'ACCOUNTANT', data_scope: 'all', name: 'Acc', permissions_json: perms('manage_payments', 'manage_financial', 'manage_subscribers') };
const MANAGER = { id: 'st-mgr', role: 'MANAGER', data_scope: 'all', name: 'Mgr', permissions_json: perms('manage_payments', 'manage_financial', 'manage_subscribers') };
const SUBSCRIBER = { id: 'sub-1', name: 'Hind', email: 'h@x.test', phone: '01012345678', lead_id: null, assigned_sales_id: null, assigned_cs_id: null, tenant_id: TENANT, branch: 'DAQQI', branch_id: 'branch-daqqi' };

const tomorrow = addDaysToDateOnly(cairoToday(), 1);
const yesterday = addDaysToDateOnly(cairoToday(), -1);
const answerWith = rules => { h.state.answer = sql => { for (const [pattern, rows] of rules) if (pattern.test(sql)) return rows; return undefined; }; };
const request = (over = {}, payment = {}) => ({
  id: 'r-1', tenant_id: TENANT, status: 'pending', requested_by: 'st-coll', requested_by_name: 'Coll', name: 'نورا', phone: '01013886813', email: null,
  amount: 4100, currency: 'EGP', created_at: '2026-11-08T16:09:00.000Z',
  body_json: JSON.stringify({ subscriber: { name: 'نورا', phone: '01013886813', branch: 'ONLINE_EGYPT' }, payment: { amount: 4100, currency: 'EGP', paymentMethod: 'فودافون كاش 2020', courseId: 'c-1', transactionId: 'TX-1', date: '2026-11-08', ...payment } }),
  ...over,
});
test.beforeEach(() => { h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; answerWith([]); });

test('a payment or a booking dated ahead is refused before anything is written; yesterday is not refused for its date', async () => {
  answerWith([[/FROM subscribers\s+WHERE id=\?/, [SUBSCRIBER]], [/SELECT name FROM staff WHERE id=\?/, [{ name: 'Acc' }]]]);
  const record = date => run(router, 'POST', '/api/admin/subscriber-payments', { as: ACCOUNTANT, harness: h, body: { subscriber_id: 'sub-1', payment: { amount: 800, currency: 'EGP', paymentMethod: 'cash', paymentType: 'OTHER', date } } });
  const ahead = await record(tomorrow);
  assert.equal(ahead.status, 400);
  assert.equal(ahead.body.code, 'PAYMENT_DATE_IN_FUTURE');
  assert.equal(h.calls.filter(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql)).length, 0);
  assert.notEqual((await record(yesterday)).body?.code, 'PAYMENT_DATE_IN_FUTURE');
  assert.notEqual((await record(cairoToday())).body?.code, 'PAYMENT_DATE_IN_FUTURE');
});

test('an instalment cannot be paid on a day that has not come', async () => {
  answerWith([[/FROM installment_plans/, [{ id: 'pl-1', tenant_id: TENANT, subscriber_id: 'sub-1', currency: 'EGP', amounts: '[500]', due_dates: '["2026-11-01"]', paid_dates: '[null]', status: 'ACTIVE' }]], [/FROM subscribers/, [SUBSCRIBER]]]);
  const pay = paidDate => run(installments, 'POST', '/api/admin/installment-plans/:planId/entries/:index/pay', { as: MANAGER, harness: h, params: { planId: 'pl-1', index: '0' }, body: { amount: 500, paidDate, paymentMethod: 'cash' } });
  const ahead = await pay(tomorrow);
  assert.equal(ahead.status, 400);
  assert.equal(ahead.body.code, 'PAYMENT_DATE_IN_FUTURE');
  assert.equal(h.state.transactions.includes('commit'), false);
});

test('a new client\'s request is accepted outright by whoever accepts payments outright; everybody else ties it to its transfer', async () => {
  const approve = (as, body = {}) => run(router, 'POST', '/api/admin/subscriber-requests/:id/approve', { as, params: { id: 'r-1' }, body, harness: h });
  answerWith([[/FROM subscriber_requests/, [request()]]]);
  const accountant = await approve(ACCOUNTANT);
  assert.equal(accountant.status, 400);
  assert.equal(accountant.body.code, 'TRANSFER_REQUIRED', 'a wallet payment is confirmed against the transfer that brought it');
  for (const who of [MANAGER, 'owner']) {
    h.calls.length = 0;
    const answer = await approve(who);
    assert.notEqual(answer.body?.code, 'TRANSFER_REQUIRED', 'the manager and the owner accept, as they do a payment');
    assert.ok(h.calls.length > 1, 'the booking went on to be recorded');
  }
  answerWith([[/FROM subscriber_requests/, [request({}, { paymentMethod: 'نقدي' })]]]);
  assert.notEqual((await approve(ACCOUNTANT)).body?.code, 'TRANSFER_REQUIRED', 'counted cash has no transfer to tie');
});

test('a request waiting is corrected in place — the figure, the box, the operation, the day — and only while it waits', async () => {
  const edit = (as, body, row = request()) => { answerWith([[/FROM subscriber_requests/, [row]]]); h.calls.length = 0; return run(router, 'PATCH', '/api/admin/subscriber-requests/:id', { as, params: { id: 'r-1' }, body, harness: h }); };
  const saved = await edit(MANAGER, { amount: 4000.456, transactionId: ' TX-9 ', date: yesterday, paymentMethod: 'انستا باي' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const update = h.calls.find(call => /^UPDATE subscriber_requests SET amount=\?, body_json=\?/.test(call.sql));
  assert.ok(update, 'the request row is rewritten');
  assert.equal(update.params[0], 4000.46);
  const body = JSON.parse(update.params[1]);
  assert.deepEqual([body.payment.amount, body.payment.transactionId, body.payment.date, body.payment.paymentMethod], [4000.46, 'TX-9', yesterday, 'انستا باي']);
  assert.equal(body.payment.courseId, 'c-1', 'the course is not something this changes');
  assert.equal(body.subscriber.name, 'نورا', 'nor the client');
  assert.deepEqual(update.params.slice(2), [TENANT, 'r-1', 'pending']);

  assert.equal((await edit(MANAGER, { date: tomorrow })).body.code, 'PAYMENT_DATE_IN_FUTURE');
  assert.equal((await edit(MANAGER, { amount: 0 })).status, 400);
  assert.equal((await edit(MANAGER, {})).status, 400, 'nothing to change');
  assert.equal((await edit(MANAGER, { amount: 10 }, request({ status: 'approved' }))).status, 409);
  assert.equal((await edit({ ...ACCOUNTANT, id: 'st-coll' }, { amount: 10 })).status, 403, 'not by the one who filed it');
  assert.equal((await run(router, 'PATCH', '/api/admin/subscriber-requests/:id', { as: 'anonymous', params: { id: 'r-1' }, body: { amount: 10 }, harness: h })).status, 401);
});

test('the queue says which branch a request is for', async () => {
  answerWith([[/FROM subscriber_requests/, [request()]]]);
  const list = await run(router, 'GET', '/api/admin/subscriber-requests', { as: MANAGER, query: { status: 'pending' }, harness: h });
  assert.equal(list.status, 200);
  assert.equal(list.body[0].branch, 'ONLINE_EGYPT');
});
