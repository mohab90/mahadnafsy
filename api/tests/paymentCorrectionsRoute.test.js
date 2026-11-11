'use strict';
// DELETE / PATCH /api/admin/payments/:id, run through their real guards and handler on a recording database: who may correct a payment,
// what a correction must carry, and what a void and a detail edit write (tenant on every statement).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/payment-corrections');
after(() => setTimeout(() => process.exit(), 200).unref());

const MANAGER = { id: 'st-mgr', role: 'MANAGER', name: 'Mona' };
const ACCOUNTANT = { id: 'st-acc', role: 'ACCOUNTANT', permissions_json: JSON.stringify(['manage_financial']) };
const NO_PERMISSION = { id: 'st-sales', role: 'SALES', permissions_json: '[]' };
const PATH = '/api/admin/payments/:id';

const payment = (over = {}) => ({
  id: 'pay-1', subscriber_id: 'sub-1', course_id: 'c-1', bundle_id: null, amount: '1500.50', currency: 'EGP', payment_type: 'course',
  payment_method: 'cash', date: '2026-10-01', note: null, transaction_id: null, status: 'pending', staff_id: 'st-x', is_installment: 0,
  course_expected: null, branch: null, source: null, cert_type: null, certificate_request_id: null, item_title: null, ...over,
});

function answerWith(rules) {
  h.state.answer = sql => {
    for (const [pattern, rows] of rules) if (pattern.test(sql)) return rows;
    return undefined;
  };
}
const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
const settled = () => h.state.transactions.filter(t => t !== 'release');

test.beforeEach(() => { h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; });

test('a payment cannot be voided or corrected without signing in', async () => {
  for (const method of ['DELETE', 'PATCH']) {
    const res = await run(router, method, PATH, { as: 'anonymous', params: { id: 'pay-1' }, body: { reason: 'x' }, harness: h });
    assert.equal(res.status, 401);
  }
  assert.equal(h.calls.length, 0, 'nothing reached the database');
});

test('a signed-in client with no staff record is refused', async () => {
  const res = await run(router, 'DELETE', PATH, { as: 'client', params: { id: 'pay-1' }, body: { reason: 'x' }, harness: h });
  assert.equal(res.status, 403);
  assert.equal(h.calls.length, 0);
});

test('staff without manage_financial are refused; one who holds it but is not a manager gets MANAGER_ONLY', async () => {
  const none = await run(router, 'DELETE', PATH, { as: NO_PERMISSION, params: { id: 'pay-1' }, body: { reason: 'x' }, harness: h });
  assert.equal(none.status, 403);
  assert.match(none.body.error, /manage_financial/);

  const accountant = await run(router, 'PATCH', PATH, { as: ACCOUNTANT, params: { id: 'pay-1' }, body: { reason: 'typo' }, harness: h });
  assert.equal(accountant.status, 403);
  assert.equal(accountant.body.code, 'MANAGER_ONLY');
  assert.equal(h.calls.length, 0, 'no payment was read or written for either');
});

test('a correction without a reason is refused before the payment is read', async () => {
  const res = await run(router, 'PATCH', PATH, { as: 'owner', params: { id: 'pay-1' }, body: { reason: '   ', amount: 100 }, harness: h });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'REASON_REQUIRED');
  assert.equal(h.calls.length, 0);
});

test('correcting a payment that does not exist (or is another tenant\'s) answers 404, and the lookup carries the tenant', async () => {
  answerWith([[/FROM payments WHERE id=\?/, []]]);
  const res = await run(router, 'PATCH', PATH, { as: 'owner', params: { id: 'pay-9' }, body: { reason: 'typo' }, harness: h });
  assert.equal(res.status, 404);
  assert.deepEqual(h.calls[0].params, ['pay-9', TENANT]);
  assert.match(h.calls[0].sql, /tenant_id=\? AND deleted_at IS NULL/);
});

test('a new currency without the amount re-entered in it is refused, not converted silently', async () => {
  answerWith([[/FROM payments WHERE id=\?/, [payment()]]]);
  const res = await run(router, 'PATCH', PATH, { as: 'owner', params: { id: 'pay-1' }, body: { reason: 'wrong currency', currency: 'usd' }, harness: h });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'AMOUNT_REQUIRED');
  assert.equal(statements(/UPDATE|INSERT/).length, 0);
});

test('a correction that changes no money only edits the details, inside a transaction', async () => {
  answerWith([[/FROM payments WHERE id=\?/, [payment()]]]);
  const res = await run(router, 'PATCH', PATH, {
    as: MANAGER, params: { id: 'pay-1' }, body: { reason: 'wrong note', amount: '1500.50', note: 'paid at the desk' }, harness: h,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.mode, 'edited');
  assert.deepEqual(settled(), ['begin', 'commit']);
  const update = statements(/UPDATE payments SET/)[0];
  assert.ok(update, 'the payment row is updated');
  assert.ok(update.params.includes('pay-1') && update.params.includes(TENANT), 'the update is scoped by id and tenant');
  assert.equal(statements(/INSERT INTO payments/).length, 0, 'no second payment is recorded for a detail edit');
});

test('voiding archives the payment with the reason and the signer, scoped to the tenant, and never deletes the row', async () => {
  answerWith([
    [/FROM payments WHERE id=\? AND tenant_id=\? AND deleted_at IS NULL LIMIT 1$/, [{ id: 'pay-1' }]],
    [/FOR UPDATE/, [payment({ status: 'pending' })]],
    [/COUNT\(\*\) AS n FROM refunds/, [{ n: 0 }]],
  ]);
  const res = await run(router, 'DELETE', PATH, { as: MANAGER, params: { id: 'pay-1' }, body: { reason: 'entered twice' }, harness: h });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const archive = statements(/UPDATE payments SET deleted_at=NOW\(\)/)[0];
  assert.ok(archive, 'the payment is archived');
  assert.equal(statements(/DELETE FROM payments/).length, 0);
  assert.match(archive.params[0], /Mona: entered twice/);
  assert.deepEqual(archive.params.slice(1), ['pay-1', TENANT]);
  assert.deepEqual(settled(), ['begin', 'commit']);
});

test('voiding without a reason rolls back and answers 400 REASON_REQUIRED', async () => {
  answerWith([[/FROM payments WHERE id=\? AND tenant_id=\? AND deleted_at IS NULL LIMIT 1$/, [{ id: 'pay-1' }]]]);
  const res = await run(router, 'DELETE', PATH, { as: 'owner', params: { id: 'pay-1' }, body: {}, harness: h });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'REASON_REQUIRED');
  assert.ok(h.state.transactions.includes('rollback'));
  assert.equal(statements(/UPDATE payments SET deleted_at/).length, 0);
});

test('a payment that already has an approved refund cannot be voided (409), and nothing is archived', async () => {
  answerWith([
    [/FROM payments WHERE id=\? AND tenant_id=\? AND deleted_at IS NULL LIMIT 1$/, [{ id: 'pay-1' }]],
    [/FOR UPDATE/, [payment({ status: 'paid' })]],
    [/COUNT\(\*\) AS n FROM refunds/, [{ n: 1 }]],
  ]);
  const res = await run(router, 'DELETE', PATH, { as: 'owner', params: { id: 'pay-1' }, body: { reason: 'oops' }, harness: h });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'HAS_REFUND');
  assert.equal(statements(/UPDATE payments SET deleted_at/).length, 0);
  assert.ok(h.state.transactions.includes('rollback'));
});
