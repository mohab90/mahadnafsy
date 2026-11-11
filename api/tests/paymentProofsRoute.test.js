'use strict';
// Transfer receipts through their real guards and handlers on a recording database: a client submits a receipt for an order that is theirs
// and pending, and the accountant lists, views and decides — with the data scope, the second reviewer, the changed-order refusal and the
// rejection reason each shown to hold.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/payment-proofs');
after(() => setTimeout(() => process.exit(), 300).unref());

const ACCOUNTANT = { id: 'st-acc', role: 'ACCOUNTANT', data_scope: 'all', name: 'Acc', permissions_json: JSON.stringify(['manage_financial', 'view_financial', 'confirm_transfers']) };
const OTHER_ACCOUNTANT = { ...ACCOUNTANT, id: 'st-acc2', name: 'Acc2' };
const VIEWER = { id: 'st-view', role: 'ACCOUNTANT', data_scope: 'all', permissions_json: JSON.stringify(['view_financial']) };
const BRANCH_ACC = { ...ACCOUNTANT, id: 'st-branch', data_scope: 'branch:DAQQI' };

const SUBMIT = '/api/me/payment-proof';
const LIST = '/api/admin/payment-proofs';
const DECIDE = '/api/admin/payment-proofs/:id';
const IMAGE = '/api/admin/payment-proofs/:id/image';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
const answerWith = rules => { h.state.answer = sql => { for (const [pattern, rows] of rules) if (pattern.test(sql)) return rows; return undefined; }; };
const settled = () => h.state.transactions.filter(t => t !== 'release');
test.beforeEach(() => { h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; answerWith([]); });

const proofRow = (over = {}) => ({
  id: 'pp-1', order_id: 'o-1', subscriber_id: 'sub-1', course_id: 'c-1', bundle_id: null, item_type: 'course', amount: '2500.00', currency: 'EGP',
  payment_method: 'instapay', proof_image: null, proof_url: null, note: null, status: 'PENDING', branch_id: 'branch-daqqi', payment_intent_id: null,
  payment_attempt_id: null, second_review_required: 0, first_reviewer_id: null, review_due_at: null, order_amount: '2500.00', order_currency: 'EGP',
  order_status: 'pending', order_notes: null, item_id: 'c-1', item_title: 'Course', customer_name: 'A', customer_email: 'a@x.test', customer_phone: '01012345678',
  lead_id: null, branch: 'DAQQI', assigned_sales_id: null, ...over,
});
const decide = (as, body, id = 'pp-1') => run(router, 'PATCH', DECIDE, { as, params: { id }, body, harness: h });

test('every receipt route refuses an anonymous caller; the staff ones refuse a plain client and a viewer without the decision permission', async () => {
  const routes = [['POST', SUBMIT, {}], ['GET', LIST, {}], ['PATCH', DECIDE, { id: 'pp-1' }], ['GET', IMAGE, { id: 'pp-1' }]];
  for (const [method, path, params] of routes) {
    assert.equal((await run(router, method, path, { as: 'anonymous', params, body: {}, harness: h })).status, 401, `${method} ${path}`);
  }
  for (const [method, path, params] of routes.slice(1)) {
    assert.equal((await run(router, method, path, { as: 'client', params, body: {}, harness: h })).status, 403, `${method} ${path} as a client`);
  }
  const res = await decide(VIEWER, { action: 'approve' });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /manage_financial, confirm_transfers/);
  assert.equal(h.calls.length, 0);
});

test('submitting a receipt needs an order id, and an image that is a real picture within the size limit', async () => {
  const submit = body => run(router, 'POST', SUBMIT, { as: 'client', body, harness: h });
  assert.equal((await submit({})).status, 400);
  answerWith([[/FROM subscribers/, [{ id: 'sub-1', email: 'client@unit.test' }]]]);
  const svg = await submit({ order_id: 'o-1', proof_image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
  assert.equal(svg.status, 400, 'an SVG is refused: it can carry script');
  const notImage = await submit({ order_id: 'o-1', proof_image: 'data:text/html;base64,PGI+PC9iPg==' });
  assert.equal(notImage.status, 400);
  const huge = await submit({ order_id: 'o-1', proof_image: `data:image/png;base64,${'A'.repeat(5 * 1024 * 1024)}` });
  assert.equal(huge.status, 400);
  assert.match(huge.body.error, /too large/);
  assert.equal(statements(/INSERT INTO payment_proofs/).length, 0);
});

test('a receipt for an order that is not the caller\'s, is already paid, or has a receipt waiting is refused and the transaction rolled back', async () => {
  const body = { order_id: 'o-1', payment_method: 'instapay' };
  answerWith([[/FROM subscribers/, [{ id: 'sub-1', email: 'client@unit.test' }]], [/FROM orders/, []]]);
  const missing = await run(router, 'POST', SUBMIT, { as: 'client', body, harness: h });
  assert.equal(missing.status, 404);
  const orderLookup = statements(/FROM orders/)[0];
  assert.match(orderLookup.sql, /tenant_id=\?/);
  assert.equal(orderLookup.params[0], 'o-1');
  assert.equal(orderLookup.params[1], TENANT);
  assert.ok(orderLookup.params.includes('sub-1') && orderLookup.params.includes('client@unit.test'), 'ownership is the subscriber link or the order\'s email');
  assert.ok(h.state.transactions.includes('rollback'));

  answerWith([[/FROM subscribers/, [{ id: 'sub-1', email: 'client@unit.test' }]], [/FROM orders/, [{ id: 'o-1', status: 'paid', amount: 100 }]]]);
  assert.equal((await run(router, 'POST', SUBMIT, { as: 'client', body, harness: h })).status, 409);

  for (const amount of ['0', '-5', '500000.01']) {
    answerWith([[/FROM subscribers/, [{ id: 'sub-1', email: 'client@unit.test' }]], [/FROM orders/, [{ id: 'o-1', status: 'pending', amount }]]]);
    const res = await run(router, 'POST', SUBMIT, { as: 'client', body, harness: h });
    assert.equal(res.status, 409, `an order of ${amount} cannot take a receipt`);
  }

  answerWith([
    [/FROM subscribers/, [{ id: 'sub-1', email: 'client@unit.test' }]],
    [/FROM orders/, [{ id: 'o-1', status: 'pending', amount: '100' }]],
    [/FROM payment_proofs/, [{ id: 'pp-old' }]],
  ]);
  const dup = await run(router, 'POST', SUBMIT, { as: 'client', body, harness: h });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /already exists/);
  assert.equal(statements(/INSERT INTO payment_proofs/).length, 0);
});

test('the list is scoped to the tenant, filtered by a valid status only, and a branch accountant sees only the branch', async () => {
  const bad = await run(router, 'GET', LIST, { as: ACCOUNTANT, query: { status: 'DONE' }, harness: h });
  assert.equal(bad.status, 400);
  assert.equal(h.calls.length, 0);

  const pending = await run(router, 'GET', LIST, { as: ACCOUNTANT, query: { status: 'pending' }, harness: h });
  assert.equal(pending.status, 200);
  assert.deepEqual(h.calls[0].params, [TENANT, 'PENDING']);
  assert.match(h.calls[0].sql, /ORDER BY \(pp\.status = 'PENDING'\) DESC/);

  h.calls.length = 0;
  await run(router, 'GET', LIST, { as: BRANCH_ACC, harness: h });
  assert.ok(h.calls[0].params.includes('branch-daqqi'), `the branch is in the parameters: ${JSON.stringify(h.calls[0].params)}`);

  h.calls.length = 0;
  const outside = await run(router, 'GET', LIST, { as: BRANCH_ACC, query: { branch: 'TAGAMOA' }, harness: h });
  assert.ok(outside.status >= 400 && outside.status < 500, 'asking for another branch than one\'s own is refused');
  assert.equal(h.calls.length, 0);
});

test('the receipt image is read inside the tenant and the data scope, and a missing one is 404', async () => {
  answerWith([[/FROM payment_proofs/, [{ proof_image: null, proof_url: 'https://drive.example/receipt', branch_id: 'branch-tagamoa' }]]]);
  const outside = await run(router, 'GET', IMAGE, { as: BRANCH_ACC, params: { id: 'pp-1' }, harness: h });
  assert.equal(outside.status, 403);
  assert.deepEqual(h.calls[0].params, ['pp-1', TENANT]);
  const inside = await run(router, 'GET', IMAGE, { as: ACCOUNTANT, params: { id: 'pp-1' }, harness: h });
  assert.equal(inside.status, 200);
  assert.equal(inside.body.url, 'https://drive.example/receipt');

  answerWith([[/FROM payment_proofs/, [{ proof_image: null, proof_url: null, branch_id: 'branch-daqqi' }]]]);
  assert.equal((await run(router, 'GET', IMAGE, { as: ACCOUNTANT, params: { id: 'pp-1' }, harness: h })).status, 404);
});

test('a decision needs approve or reject, a note within 2,000 characters, and a reason for a rejection', async () => {
  assert.equal((await decide(ACCOUNTANT, { action: 'maybe' })).status, 400);
  const long = await decide(ACCOUNTANT, { action: 'approve', reviewer_note: 'x'.repeat(2001) });
  assert.equal(long.status, 400);
  assert.equal(long.body.code, 'REVIEW_NOTE_TOO_LONG');
  for (const note of [undefined, '', '  ', 'ab']) {
    const res = await decide(ACCOUNTANT, { action: 'reject', reviewer_note: note });
    assert.equal(res.status, 400, `a rejection with the note ${JSON.stringify(note)}`);
    assert.equal(res.body.code, 'REJECT_REASON_REQUIRED');
  }
  assert.equal(statements(/UPDATE payment_proofs/).length, 0);
});

test('a decision on a receipt that is missing, outside the branch scope, already decided, or whose order is no longer pending changes nothing', async () => {
  answerWith([[/FROM payment_proofs pp/, []]]);
  const missing = await decide(ACCOUNTANT, { action: 'approve' });
  assert.equal(missing.status, 404);
  assert.deepEqual(h.calls[0].params, ['pp-1', TENANT], 'the receipt is looked up inside the tenant');
  assert.match(h.calls[0].sql, /FOR UPDATE/, 'and locked while it is decided');

  answerWith([[/FROM payment_proofs pp/, [proofRow({ branch: 'TAGAMOA', branch_id: 'branch-tagamoa' })]]]);
  assert.equal((await decide(BRANCH_ACC, { action: 'approve' })).status, 403);

  answerWith([[/FROM payment_proofs pp/, [proofRow({ status: 'APPROVED' })]]]);
  const again = await decide(ACCOUNTANT, { action: 'approve' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'Already reviewed');

  answerWith([[/FROM payment_proofs pp/, [proofRow({ order_status: 'paid' })]]]);
  assert.equal((await decide(ACCOUNTANT, { action: 'approve' })).status, 409);

  assert.equal(statements(/UPDATE payment_proofs|INSERT INTO payments/).length, 0);
  assert.ok(h.state.transactions.includes('rollback'));
});

test('approving a receipt whose order changed in amount or currency after the upload is refused with ORDER_CHANGED_SINCE_PROOF', async () => {
  for (const change of [{ order_amount: '9000.00' }, { order_currency: 'SAR' }]) {
    answerWith([[/FROM payment_proofs pp/, [proofRow(change)]]]);
    const res = await decide(ACCOUNTANT, { action: 'approve' });
    assert.equal(res.status, 409, JSON.stringify(change));
    assert.equal(res.body.code, 'ORDER_CHANGED_SINCE_PROOF');
    assert.equal(statements(/INSERT INTO payments/).length, 0, 'no payment is booked at the new terms');
  }
  // A difference of a cent is rounding, not a change.
  answerWith([[/FROM payment_proofs pp/, [proofRow({ order_amount: '2500.004', second_review_required: 1 })]]]);
  assert.equal((await decide(ACCOUNTANT, { action: 'approve' })).status, 200);
});

test('a large receipt needs two reviewers: the first approval only records itself, and the same person cannot give the second', async () => {
  answerWith([[/FROM payment_proofs pp/, [proofRow({ second_review_required: 1, amount: '80000.00', order_amount: '80000.00' })]]]);
  const first = await decide(ACCOUNTANT, { action: 'approve', reviewer_note: 'checked the bank' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.pendingSecondApproval, true);
  assert.equal(first.body.status, 'PENDING');
  const marked = statements(/SET first_reviewer_id=\?/)[0];
  assert.deepEqual([marked.params[0], marked.params[1]], ['st-acc', 'checked the bank']);
  assert.deepEqual(marked.params.slice(3), ['pp-1', TENANT]);
  assert.equal(statements(/INSERT INTO payments/).length, 0, 'no money is booked on the first approval');
  assert.equal(statements(/SET status=\?/).length, 0);

  h.calls.length = 0;
  answerWith([[/FROM payment_proofs pp/, [proofRow({ second_review_required: 1, first_reviewer_id: 'st-acc' })]]]);
  const same = await decide(ACCOUNTANT, { action: 'approve' });
  assert.equal(same.status, 409);
  assert.equal(same.body.code, 'SECOND_REVIEWER_REQUIRED');
  assert.equal(statements(/INSERT INTO payments/).length, 0);
});

test('rejecting writes the status, the reviewer and the reason, books no payment and says so', async () => {
  answerWith([[/FROM payment_proofs pp/, [proofRow()]]]);
  const res = await decide(OTHER_ACCOUNTANT, { action: 'reject', reviewer_note: 'the amount does not match the transfer' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { ok: true, status: 'REJECTED' });
  const update = statements(/UPDATE payment_proofs SET status=\?/)[0];
  assert.deepEqual([update.params[0], update.params[1], update.params[2]], ['REJECTED', 'st-acc2', 'the amount does not match the transfer']);
  assert.deepEqual(update.params.slice(4), ['pp-1', TENANT]);
  assert.equal(statements(/INSERT INTO payments/).length, 0);
  assert.equal(statements(/UPDATE orders SET status='paid'/).length, 0, 'the order stays unpaid');
  assert.deepEqual(settled(), ['begin', 'commit']);
});
