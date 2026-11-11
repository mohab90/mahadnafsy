'use strict';
// POST /api/admin/subscriber-payments (the desk's one way of recording money) and the collection officers' new-client requests, run through
// their real guards and handler on a recording database. What is shown: who may record, every refusal made before money is written, what a
// collection officer's booking becomes (a request, not a payment), and that a twin payment or a busy client is refused with the transaction undone.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/subscriber-payments');
after(() => setTimeout(() => process.exit(), 300).unref());

const PATH = '/api/admin/subscriber-payments';
const BOXES = '/api/admin/payment-boxes';
const MINE = '/api/staff/subscriber-requests';
const QUEUE = '/api/admin/subscriber-requests';
const APPROVE = '/api/admin/subscriber-requests/:id/approve';
const REJECT = '/api/admin/subscriber-requests/:id/reject';

const perms = (...list) => JSON.stringify(list);
const ACCOUNTANT = { id: 'st-acc', role: 'ACCOUNTANT', data_scope: 'all', name: 'Acc', permissions_json: perms('manage_payments', 'manage_financial', 'manage_subscribers') };
const RECEPTION = { id: 'st-rec', role: 'RECEPTION', data_scope: 'all', name: 'Rec', permissions_json: perms('manage_payments') };
const COLLECTION = { id: 'st-coll', role: 'COLLECTION', data_scope: 'assigned_cs', name: 'Coll', permissions_json: perms('manage_payments', 'manage_financial', 'manage_subscribers') };
const NO_RIGHTS = { id: 'st-none', role: 'SALES', data_scope: 'all', permissions_json: '[]' };

const SUBSCRIBER = { id: 'sub-1', name: 'Hind', email: 'h@x.test', phone: '01012345678', lead_id: null, assigned_sales_id: null, assigned_cs_id: 'st-coll', tenant_id: TENANT, branch: 'DAQQI', branch_id: 'branch-daqqi', client_code: 'C1' };
const cash = (over = {}) => ({ subscriber_id: 'sub-1', payment: { amount: 1200.5, currency: 'EGP', paymentMethod: 'cash', paymentType: 'OTHER', ...over } });

const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
const answerWith = rules => { h.state.answer = sql => { for (const [pattern, rows] of rules) if (pattern.test(sql)) return rows; return undefined; }; };
const withSubscriber = (...more) => answerWith([[/FROM subscribers\s+WHERE id=\?/, [SUBSCRIBER]], [/SELECT name FROM staff WHERE id=\?/, [{ name: 'Acc' }]], ...more]);
const record = (as, body) => run(router, 'POST', PATH, { as, body, harness: h });
const wrote = () => statements(/^(INSERT|UPDATE|DELETE)/);
test.beforeEach(() => { h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; answerWith([]); });

test('recording needs a signed-in staff member holding manage_payments; the boxes list needs the same', async () => {
  for (const [method, path] of [['POST', PATH], ['GET', BOXES]]) {
    assert.equal((await run(router, method, path, { as: 'anonymous', body: cash(), harness: h })).status, 401);
    assert.equal((await run(router, method, path, { as: 'client', body: cash(), harness: h })).status, 403);
    const none = await run(router, method, path, { as: NO_RIGHTS, body: cash(), harness: h });
    assert.equal(none.status, 403);
    assert.match(none.body.error, /manage_payments/);
  }
  assert.equal(h.calls.length, 0);
});

test('the boxes list counts only paid, undeleted payments of the tenant and rounds the totals', async () => {
  answerWith([[/GROUP BY payment_method/, [{ box: 'Vodafone Cash 2020', payments: '3', egp: '1500.6' }, { box: 'cash', payments: 1, egp: null }]]]);
  const res = await run(router, 'GET', BOXES, { as: RECEPTION, harness: h });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ box: 'Vodafone Cash 2020', payments: 3, egp: 1501 }, { box: 'cash', payments: 1, egp: 0 }]);
  assert.match(h.calls[0].sql, /status = 'paid'/);
  assert.match(h.calls[0].sql, /deleted_at IS NULL/);
  assert.deepEqual(h.calls[0].params, [TENANT]);
});

test('a booking without a client or without a payment is refused', async () => {
  for (const body of [{}, { subscriber_id: 'sub-1' }, { payment: { amount: 5 } }]) {
    const res = await record('owner', body);
    // A draft client is assumed when neither a client nor a lead is named, so the missing piece may be the payment or the draft's name.
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(wrote().length, 0);
});

test('an amount must be a positive number below ten million, in EGP, SAR or USD, with a paid or pending status', async () => {
  for (const amount of [0, -1, 'abc', null, '', NaN, 10000000.01]) {
    const res = await record('owner', cash({ amount }));
    assert.equal(res.status, 400, `amount ${String(amount)}`);
    assert.equal(res.body.code, 'AMOUNT_INVALID');
  }
  const eur = await record('owner', cash({ currency: 'eur' }));
  assert.equal(eur.body.code, 'CURRENCY_UNSUPPORTED');
  const refunded = await record('owner', cash({ status: 'refunded' }));
  assert.equal(refunded.body.code, 'STATUS_INVALID');
  assert.equal(h.calls.length, 0, 'every one of these is answered before the database is asked anything');
});

test('a paid payment must say which box the money went into, and a payment is for a course or a bundle, not both', async () => {
  withSubscriber();
  const noBox = await record('owner', cash({ paymentMethod: '  ' }));
  assert.equal(noBox.status, 400);
  assert.match(noBox.body.error, /طريقة الدفع/);

  const both = await record('owner', cash({ courseId: 'c-1', bundleId: 'b-1', paymentType: 'COURSE' }));
  assert.equal(both.body.code, 'COURSE_AND_BUNDLE');

  const noItem = await record('owner', cash({ paymentType: 'COURSE' }));
  assert.equal(noItem.status, 400, 'a course payment names its course');

  const cert = await record('owner', cash({ paymentType: 'CERTIFICATE' }));
  assert.equal(cert.body.code, 'CERTIFICATE_TYPE_REQUIRED');
  const certLong = await record('owner', cash({ paymentType: 'CERTIFICATE', certId: 'x'.repeat(37) }));
  assert.equal(certLong.body.code, 'CERTIFICATE_REQUEST_INVALID');

  for (const courseExpected of [0, -100, 'abc', 10000001]) {
    const res = await record('owner', cash({ courseExpected }));
    assert.equal(res.body?.code, 'EXPECTED_INVALID', `agreed price ${courseExpected}`);
  }
  assert.equal(wrote().length, 0);
  assert.equal(h.state.transactions.length, 0);
});

test('a client that is not in the tenant is 404, and the lookup is scoped by tenant and by not-deleted', async () => {
  answerWith([[/FROM subscribers\s+WHERE id=\?/, []]]);
  const res = await record('owner', cash());
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'SUBSCRIBER_NOT_FOUND');
  const lookup = statements(/FROM subscribers\s+WHERE id=\?/)[0];
  assert.deepEqual(lookup.params, ['sub-1', TENANT]);
  assert.match(lookup.sql, /deleted_at IS NULL/);
});

test('a rep cannot book money on another officer\'s client, and nobody can book a client who has no dialable phone', async () => {
  withSubscriber();
  const sales = { id: 'st-sales', role: 'SALES', data_scope: 'assigned_sales', permissions_json: perms('manage_payments') };
  const outside = await record(sales, cash());
  assert.equal(outside.status, 403);
  assert.equal(outside.body.code, 'SUBSCRIBER_OUT_OF_SCOPE');

  answerWith([[/FROM subscribers\s+WHERE id=\?/, [{ ...SUBSCRIBER, phone: '123' }]]]);
  const noPhone = await record('owner', cash());
  assert.equal(noPhone.status, 400);
  assert.equal(noPhone.body.code, 'PHONE_REQUIRED');
  assert.equal(wrote().length, 0);
});

test('a branch outside the caller\'s financial scope is refused, not filed under the client\'s branch', async () => {
  withSubscriber();
  const dokki = { ...ACCOUNTANT, id: 'st-dokki', data_scope: 'branch:DAQQI' };
  const res = await record(dokki, cash({ branch: 'TAGAMOA' }));
  assert.ok(res.status === 403 || res.status === 400, `status ${res.status}`);
  assert.equal(wrote().length, 0);
});

test('a new client needs manage_subscribers, a name and a phone, a branch, and must not already exist', async () => {
  const draft = (subscriber, payment = {}) => ({ subscriber, payment: { amount: 500, currency: 'EGP', paymentMethod: 'cash', ...payment } });
  const noRight = await record(RECEPTION, draft({ name: 'New', phone: '01099998888', branch: 'DAQQI' }));
  assert.equal(noRight.status, 403);
  assert.equal(noRight.body.code, 'CANNOT_CREATE_CLIENT');

  const noName = await record('owner', draft({ name: '', phone: '01099998888', branch: 'DAQQI' }));
  assert.equal(noName.body.code, 'NAME_PHONE_REQUIRED');

  const noBranch = await record('owner', draft({ name: 'New', phone: '01099998888' }));
  assert.equal(noBranch.body.code, 'BRANCH_REQUIRED');

  answerWith([[/FROM subscribers\s+WHERE tenant_id=\? AND deleted_at IS NULL\s+AND \(/, [{ id: 'sub-9', name: 'Existing', client_code: 'C9', phone: '1099998888', email: null, owner_name: 'Mona' }]]]);
  const exists = await record('owner', draft({ name: 'New', phone: '01099998888', branch: 'DAQQI' }));
  assert.equal(exists.status, 409);
  assert.equal(exists.body.code, 'SUBSCRIBER_EXISTS');
  assert.equal(exists.body.existingId, 'sub-9');
  assert.match(exists.body.error, /Mona/);
  assert.equal(wrote().length, 0);
});

test('a collection officer\'s booking of a new client becomes a request for the manager, with no payment and no secret kept', async () => {
  answerWith([[/SELECT name FROM staff WHERE id=\?/, [{ name: 'Coll' }]]]);
  const res = await record(COLLECTION, {
    subscriber: { name: 'New Client', phone: '01099998888', branch: 'DAQQI', password: 'hunter2-secret' },
    payment: { amount: '2500.75', currency: 'egp', paymentMethod: 'Vodafone Cash', paymentType: 'OTHER', status: 'paid' },
  });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  assert.equal(res.body.status, 'pending_review');
  assert.equal(res.body.approvalRequired, true);
  assert.equal(statements(/INSERT INTO payments/).length, 0, 'no payment row is written by a collection officer');
  assert.equal(statements(/INSERT INTO subscribers/).length, 0, 'and no client');
  const insert = statements(/INSERT INTO subscriber_requests/)[0];
  assert.ok(insert, 'a request is filed');
  const [, tenant, requestedBy, requestedByName, , name, , , amount, currency, bodyJson] = insert.params;
  assert.equal(tenant, TENANT);
  assert.equal(requestedBy, 'st-coll');
  assert.equal(requestedByName, 'Coll');
  assert.equal(name, 'New Client');
  assert.strictEqual(amount, 2500.75, 'the amount is stored as a decimal number');
  assert.equal(currency, 'EGP');
  assert.doesNotMatch(bodyJson, /hunter2/, 'the password typed into the draft is not kept in the request');
});

test('a payment identical to one already recorded the same day is refused, and a client being booked at that moment makes the second wait; both undo the transaction', async () => {
  withSubscriber([/SELECT GET_LOCK/, [{ acquired: 1 }]], [/FROM payments\s+WHERE tenant_id = \? AND deleted_at IS NULL\s+AND subscriber_id = \?/, [{ id: 'pay-old' }]]);
  const twin = await record('owner', cash({ date: '2026-10-05', transactionId: 'TX-1' }));
  assert.equal(twin.status, 409);
  const twinQuery = statements(/FROM payments\s+WHERE tenant_id = \? AND deleted_at IS NULL\s+AND subscriber_id = \?/)[0];
  assert.deepEqual(twinQuery.params.slice(0, 4), [TENANT, 'sub-1', 1200.5, '2026-10-05']);
  assert.ok(h.state.transactions.includes('rollback'));
  assert.equal(statements(/INSERT INTO payments/).length, 0);

  h.calls.length = 0;
  h.state.transactions.length = 0;
  withSubscriber([/SELECT GET_LOCK/, [{ acquired: 0 }]]);
  const busy = await record('owner', cash());
  assert.equal(busy.status, 409);
  assert.equal(statements(/INSERT INTO payments/).length, 0);
  assert.ok(!h.state.transactions.includes('begin'), 'the transaction never started without the per-client lock');
});

test('the officer\'s own request list is theirs only, and a viewer with no staff row sees none', async () => {
  answerWith([[/FROM subscriber_requests/, [{ id: 'r-1', status: 'pending', name: 'N', amount: '99.5', currency: 'EGP', body_json: '{"payment":{"courseId":"c-1","isInstallment":1}}' }]]]);
  const res = await run(router, 'GET', MINE, { as: COLLECTION, harness: h });
  assert.equal(res.status, 200);
  assert.deepEqual(h.calls[0].params, [TENANT, 'st-coll']);
  assert.equal(res.body[0].amount, 99.5);
  assert.equal(res.body[0].payment.courseId, 'c-1');
  assert.equal(res.body[0].payment.isInstallment, true);
  assert.equal((await run(router, 'GET', MINE, { as: 'anonymous', harness: h })).status, 401);
  h.calls.length = 0;
  const owner = await run(router, 'GET', MINE, { as: 'owner', harness: h });
  assert.deepEqual(owner.body, [], 'the owner has no officer record, so no personal requests');
  assert.equal(h.calls.length, 0);
});

test('the manager queue needs manage_financial and filters by a known status only', async () => {
  assert.equal((await run(router, 'GET', QUEUE, { as: RECEPTION, harness: h })).status, 403);
  answerWith([[/FROM subscriber_requests/, []]]);
  await run(router, 'GET', QUEUE, { as: ACCOUNTANT, query: { status: 'pending' }, harness: h });
  assert.deepEqual(h.calls.at(-1).params, [TENANT, 'pending']);
  await run(router, 'GET', QUEUE, { as: ACCOUNTANT, query: { status: "pending' OR 1=1 --" }, harness: h });
  assert.deepEqual(h.calls.at(-1).params, [TENANT], 'an unknown status is ignored, never sent to SQL');
});

test('approving a request: missing, already reviewed, by the officer who filed it, or by a collection officer — each refused; cash needs no transfer, other boxes do', async () => {
  const request = (over = {}) => ({ id: 'r-1', status: 'pending', requested_by: 'st-coll', body_json: JSON.stringify({ payment: { paymentMethod: 'Vodafone Cash', amount: 100 }, subscriber: {} }), ...over });
  const approve = (as, body = {}) => run(router, 'POST', APPROVE, { as, params: { id: 'r-1' }, body, harness: h });

  answerWith([[/FROM subscriber_requests/, []]]);
  assert.equal((await approve(ACCOUNTANT)).status, 404);
  assert.deepEqual(h.calls[0].params, [TENANT, 'r-1']);

  answerWith([[/FROM subscriber_requests/, [request({ status: 'approved' })]]]);
  assert.equal((await approve(ACCOUNTANT)).status, 409);

  answerWith([[/FROM subscriber_requests/, [request()]]]);
  const own = await approve({ ...ACCOUNTANT, id: 'st-coll' });
  assert.equal(own.status, 403, 'nobody approves a request they filed');
  const byCollection = await approve({ ...COLLECTION, id: 'st-other-coll' });
  assert.equal(byCollection.status, 403, 'approving collection bookings is the manager\'s work');

  const noTransfer = await approve(ACCOUNTANT);
  assert.equal(noTransfer.status, 400);
  assert.equal(noTransfer.body.code, 'TRANSFER_REQUIRED');
  assert.equal(statements(/INSERT INTO payments/).length, 0);
});

test('rejecting a request records the reviewer and note, only while it is pending, and only by someone who may review', async () => {
  const reject = (as, body = {}) => run(router, 'POST', REJECT, { as, params: { id: 'r-1' }, body, harness: h });
  answerWith([[/FROM subscriber_requests/, []]]);
  assert.equal((await reject(ACCOUNTANT)).status, 404);

  answerWith([[/SELECT id, requested_by, status, name FROM subscriber_requests/, [{ id: 'r-1', requested_by: 'st-coll', status: 'pending', name: 'N' }]]]);
  assert.equal((await reject({ ...COLLECTION, id: 'st-x' })).status, 403);

  const ok = await reject(ACCOUNTANT, { note: 'transfer never arrived' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const update = statements(/UPDATE subscriber_requests SET status='rejected'/)[0];
  assert.match(update.sql, /status='pending'/, 'only a pending request can be rejected');
  assert.deepEqual([update.params[0], update.params[1], update.params[2]], ['transfer never arrived', 'st-acc', 'Acc']);
  assert.deepEqual(update.params.slice(3), [TENANT, 'r-1']);

  h.state.answer = sql => (/SELECT id, requested_by/.test(sql) ? [{ id: 'r-1', requested_by: 'st-coll', status: 'approved', name: 'N' }] : /UPDATE subscriber_requests/.test(sql) ? { affectedRows: 0 } : undefined);
  assert.equal((await reject(ACCOUNTANT)).status, 409, 'a request decided meanwhile is not overwritten');
});
