'use strict';
// The orders desk through its real guards and handlers on a recording database: who may list, create, confirm and archive orders, that the
// financial statuses are never set by a bare write, that the data scope is part of every read, and that confirming a payment keeps the
// separation of duties (the person who recorded an order or earns its commission does not approve it).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/orders');
after(() => setTimeout(() => process.exit(), 300).unref());

const perms = (...list) => JSON.stringify(list);
const ACCOUNTANT = { id: 'st-acc', role: 'ACCOUNTANT', data_scope: 'all', name: 'Acc', permissions_json: perms('view_orders', 'manage_orders', 'manage_financial') };
const VIEWER = { id: 'st-view', role: 'SALES', data_scope: 'all', permissions_json: perms('view_orders') };
const DAQQI_DESK = { ...ACCOUNTANT, id: 'st-dokki', data_scope: 'branch:DAQQI' };
const OWN_CLIENTS = { ...ACCOUNTANT, id: 'st-rep', role: 'SALES', data_scope: 'assigned_sales' };

const LIST = '/api/admin/orders';
const ONE = '/api/admin/orders/:id';
const CONFIRM = '/api/admin/orders/:id/confirm-payment';
const ABANDONED = '/api/admin/abandoned-checkouts';
const MINE = '/api/me/orders';

const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
const answerWith = rules => { h.state.answer = sql => { for (const [pattern, rows] of rules) if (pattern.test(sql)) return rows; return undefined; }; };
const wrote = () => statements(/^(INSERT|UPDATE|DELETE)/);
test.beforeEach(() => { h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; answerWith([]); });

test('every orders route refuses anonymous callers; staff routes refuse a client and a missing permission', async () => {
  const routes = [['GET', LIST, 'view_orders'], ['POST', LIST, 'manage_orders'], ['PATCH', ONE, 'manage_orders'], ['POST', CONFIRM, 'manage_financial']];
  for (const [method, path, permission] of routes) {
    const params = { id: 'o-1' };
    assert.equal((await run(router, method, path, { as: 'anonymous', params, body: {}, harness: h })).status, 401, `${method} ${path}`);
    assert.equal((await run(router, method, path, { as: 'client', params, body: {}, harness: h })).status, 403, `${method} ${path} client`);
    const res = await run(router, method, path, { as: { id: 'st-nobody', role: 'SALES', permissions_json: '[]' }, params, body: {}, harness: h });
    assert.equal(res.status, 403, `${method} ${path} without ${permission}`);
  }
  // A viewer cannot write, and neither can they approve money.
  assert.equal((await run(router, 'POST', LIST, { as: VIEWER, body: { item_id: 'c-1', item_title: 'T', amount: 1 }, harness: h })).status, 403);
  assert.equal((await run(router, 'POST', CONFIRM, { as: VIEWER, params: { id: 'o-1' }, body: {}, harness: h })).status, 403);
  // Archiving and abandoned-cart lists are for administrators only, whatever staff permissions say.
  assert.equal((await run(router, 'DELETE', ONE, { as: ACCOUNTANT, params: { id: 'o-1' }, harness: h })).status, 403);
  assert.equal((await run(router, 'GET', ABANDONED, { as: ACCOUNTANT, harness: h })).status, 403);
  assert.equal(h.calls.length, 0);
});

test('the orders list reads orders and payments of the tenant only, and a branch desk reads its branch only', async () => {
  const all = await run(router, 'GET', LIST, { as: ACCOUNTANT, harness: h });
  assert.equal(all.status, 200);
  assert.ok(h.calls.length >= 4, 'orders, pending orders, payments, pending payments');
  for (const call of h.calls) assert.equal(call.params[0], TENANT, `the tenant leads the parameters of: ${call.sql.slice(0, 40)}`);

  h.calls.length = 0;
  await run(router, 'GET', LIST, { as: DAQQI_DESK, harness: h });
  for (const call of statements(/FROM (orders|payments)/)) assert.ok(call.params.includes('branch-daqqi'), `branch filter missing from: ${call.sql.slice(0, 50)}`);

  h.calls.length = 0;
  await run(router, 'GET', LIST, { as: OWN_CLIENTS, harness: h });
  for (const call of statements(/FROM (orders|payments)/)) assert.ok(call.params.includes('st-rep'), 'a rep reads only the orders of their own clients');
});

test('the list shows an order\'s status and type in lowercase, a manual payment as an order of its own, and a payment already shown as an order only once', async () => {
  answerWith([
    [/FROM orders o/, [{ id: 'o-1', status: 'PENDING', type: 'COURSE', transaction_id: 'TX-9', amount: '100.00' }]],
    [/FROM payments p/, [
      { id: 'p-1', amount: '250.75', currency: 'SAR', status: 'paid', payment_type: 'COURSE', transaction_id: 'TX-9', date: '2026-10-01', created_at: '2026-10-01T09:00:00Z' },
      { id: 'p-2', amount: '99.5', currency: 'EGP', status: 'paid', payment_type: 'BOOK', transaction_id: 'TX-2', date: '2026-10-02', created_at: '2026-10-02T09:00:00Z' },
    ]],
  ]);
  const res = await run(router, 'GET', LIST, { as: ACCOUNTANT, harness: h });
  assert.equal(res.status, 200);
  const order = res.body.find(r => r.id === 'o-1');
  assert.equal(order.status, 'pending');
  assert.equal(order.type, 'course');
  assert.equal(res.body.filter(r => r.id === 'o-1').length, 1, 'the pending-orders pass does not list it twice');
  assert.equal(res.body.find(r => r.id === 'p-1'), undefined, 'a payment whose transaction is an order already listed is not shown twice');
  const manual = res.body.find(r => r.id === 'p-2');
  assert.strictEqual(manual.amount, 99.5);
  assert.equal(manual.source, 'crm');
});

test('creating an order validates its columns, and never accepts a paid or refunded status', async () => {
  const create = body => run(router, 'POST', LIST, { as: ACCOUNTANT, body, harness: h });
  assert.equal((await create({ item_title: 'T', amount: 1 })).status, 400);
  assert.equal((await create({ item_id: 'c-1', amount: 1 })).status, 400);
  for (const amount of [-1, 'abc', undefined, Infinity]) assert.equal((await create({ item_id: 'c-1', item_title: 'T', amount })).status, 400, `amount ${amount}`);
  for (const status of ['paid', 'PAID', 'refunded']) {
    const res = await create({ item_id: 'c-1', item_title: 'T', amount: 5, status });
    assert.equal(res.status, 409, status);
  }
  assert.equal(wrote().length, 0);
});

test('creating an order for a client outside the caller\'s scope is 403; for a client inside it, the row carries the tenant, a decimal amount and a pending status', async () => {
  const body = { id: 'o-new', subscriber_id: 'sub-1', item_id: 'c-1', item_title: 'Course', amount: '1999.99', currency: 'SAR' };
  answerWith([[/FROM subscribers/, [{ id: 'sub-1', branch_id: 'branch-tagamoa', assigned_sales_id: 'st-other', assigned_cs_id: null }]]]);
  const outside = await run(router, 'POST', LIST, { as: OWN_CLIENTS, body, harness: h });
  assert.equal(outside.status, 403);
  assert.equal(wrote().length, 0);

  answerWith([[/FROM subscribers/, [{ id: 'sub-1', branch_id: 'branch-daqqi', assigned_sales_id: 'st-rep', assigned_cs_id: null }]]]);
  const inside = await run(router, 'POST', LIST, { as: OWN_CLIENTS, body, harness: h });
  assert.equal(inside.status, 200, JSON.stringify(inside.body));
  const insert = statements(/INSERT INTO orders/)[0];
  assert.deepEqual(insert.params.slice(0, 2), ['o-new', 'sub-1']);
  assert.equal(insert.params[5], 'pending');
  assert.strictEqual(insert.params[6], 1999.99);
  assert.equal(insert.params[7], 'SAR');
  assert.equal(insert.params[12], TENANT);

  h.calls.length = 0;
  const unlinked = await run(router, 'POST', LIST, { as: OWN_CLIENTS, body: { item_id: 'c-1', item_title: 'T', amount: 5 }, harness: h });
  assert.equal(unlinked.status, 403, 'an assigned-scope rep must link the order to one of their clients');
});

test('confirming payment: 404 for an unknown order or one outside the caller\'s scope; the recorder, the earning rep and a repeat confirmation are refused', async () => {
  const confirm = (as, body = {}) => run(router, 'POST', CONFIRM, { as, params: { id: 'o-1' }, body, harness: h });
  const order = (over = {}) => ({ id: 'o-1', status: 'PENDING', subscriber_id: 'sub-1', staff_id: null, payment_method: 'cash', amount: '500.00', currency: 'EGP', branch_id: 'branch-daqqi', ...over });
  const subscriber = (over = {}) => ({ id: 'sub-1', branch_id: 'branch-daqqi', assigned_sales_id: null, assigned_cs_id: null, ...over });

  answerWith([[/FROM orders WHERE id=\?/, []]]);
  assert.equal((await confirm(ACCOUNTANT)).status, 404);
  assert.deepEqual(h.calls[0].params, ['o-1', TENANT]);
  assert.match(h.calls[0].sql, /FOR UPDATE/);
  assert.ok(h.state.transactions.includes('rollback'));

  answerWith([[/FROM orders WHERE id=\?/, [order()]], [/FROM subscribers WHERE tenant_id=\?/, [subscriber({ branch_id: 'branch-tagamoa' })]]]);
  assert.equal((await confirm(DAQQI_DESK)).status, 404, 'an order of another branch looks like it does not exist');

  answerWith([[/FROM orders WHERE id=\?/, [order({ staff_id: 'st-acc' })]], [/FROM subscribers WHERE tenant_id=\?/, [subscriber()]]]);
  const own = await confirm(ACCOUNTANT);
  assert.equal(own.status, 403);
  assert.match(own.body.error, /recorded an order cannot approve/);

  answerWith([[/FROM orders WHERE id=\?/, [order()]], [/FROM subscribers WHERE tenant_id=\?/, [subscriber({ assigned_sales_id: 'st-rep' })]]]);
  const earner = await confirm({ ...ACCOUNTANT, id: 'st-rep', role: 'SALES' });
  assert.equal(earner.status, 403, 'the rep who earns the commission does not approve the money');

  answerWith([[/FROM orders WHERE id=\?/, [order({ status: 'PAID' })]], [/FROM subscribers WHERE tenant_id=\?/, [subscriber()]]]);
  assert.equal((await confirm(ACCOUNTANT)).status, 409);

  assert.equal(statements(/INSERT INTO payments|UPDATE orders/).length, 0, 'no payment was booked in any of these');
});

test('confirming an order that has no client yet reaches the payment step instead of failing on the missing client row', async () => {
  // An order from the website checkout has no subscriber until its receipt is submitted (routes/payment-proofs.js).
  answerWith([[/FROM orders WHERE id=\?/, [{ id: 'o-1', status: 'PENDING', subscriber_id: null, staff_id: null, payment_method: 'bank transfer', amount: '500.00', currency: 'EGP', branch_id: 'branch-daqqi' }]]]);
  const res = await run(router, 'POST', CONFIRM, { as: ACCOUNTANT, params: { id: 'o-1' }, body: {}, harness: h });
  assert.notEqual(res.status, 500, `an order with no client answered ${res.status}: ${JSON.stringify(res.body)}`);
});

test('a transfer must be linked unless the caller is the manager or the box is cash; a linked transfer must exist and be free', async () => {
  const collection = { ...ACCOUNTANT, id: 'st-coll', role: 'COLLECTION' };
  const base = [[/FROM orders WHERE id=\?/, [{ id: 'o-1', status: 'PENDING', subscriber_id: 'sub-1', staff_id: null, payment_method: 'Vodafone Cash', amount: '500.00', currency: 'EGP', branch_id: 'branch-daqqi' }]],
    [/FROM subscribers WHERE tenant_id=\?/, [{ id: 'sub-1', branch_id: 'branch-daqqi', assigned_sales_id: null, assigned_cs_id: null }]]];
  answerWith(base);
  const unlinked = await run(router, 'POST', CONFIRM, { as: collection, params: { id: 'o-1' }, body: {}, harness: h });
  assert.equal(unlinked.status, 400);
  assert.equal(unlinked.body.code, 'TRANSFER_REQUIRED');

  answerWith([...base, [/FROM incoming_transfers/, []]]);
  const missing = await run(router, 'POST', CONFIRM, { as: collection, params: { id: 'o-1' }, body: { linkedTransferId: 'tr-1' }, harness: h });
  assert.equal(missing.status, 404);
  assert.deepEqual(statements(/FROM incoming_transfers/)[0].params, ['tr-1', TENANT]);

  answerWith([...base, [/FROM incoming_transfers/, [{ id: 'tr-1', method: 'Vodafone Cash', reference: 'R1', payment_id: 'pay-9' }]]]);
  const used = await run(router, 'POST', CONFIRM, { as: collection, params: { id: 'o-1' }, body: { linkedTransferId: 'tr-1' }, harness: h });
  assert.equal(used.status, 409, 'one transfer cannot confirm two orders');
  assert.equal(statements(/INSERT INTO payments/).length, 0);
});

test('changing an order\'s status: a financial status is refused, a failure needs a reason, and an order that already carries money is never changed', async () => {
  const patch = (body, as = ACCOUNTANT) => run(router, 'PATCH', ONE, { as, params: { id: 'o-1' }, body, harness: h });
  for (const status of ['paid', 'refunded']) assert.equal((await patch({ status })).status, 409, status);
  assert.equal((await patch({ status: 'no-such-state' })).status, 400);
  const noReason = await patch({ status: 'failed' });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.code, 'REJECT_REASON_REQUIRED');
  assert.equal(h.calls.length, 0);

  answerWith([[/FROM orders o\s+LEFT JOIN subscribers s/, []]]);
  assert.equal((await patch({ status: 'pending' })).status, 404);

  const row = { id: 'o-1', status: 'pending', branch_id: 'branch-daqqi', subscriber_id: 'sub-1', assigned_sales_id: null, assigned_cs_id: null };
  answerWith([[/FROM orders o\s+LEFT JOIN subscribers s/, [row]], [/SELECT id FROM payments/, [{ id: 'pay-1' }]]]);
  const hasMoney = await patch({ status: 'pending' });
  assert.equal(hasMoney.status, 409);
  assert.equal(statements(/UPDATE orders SET status/).length, 0);

  answerWith([[/FROM orders o\s+LEFT JOIN subscribers s/, [row]], [/FROM incoming_transfers/, [{ id: 'tr-4', payment_id: null }]]]);
  const ok = await patch({ status: 'failed', reason: 'the amount does not match', linked_transfer_id: 'tr-4' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const update = statements(/UPDATE orders SET status=\?/)[0];
  assert.deepEqual(update.params, ['failed', 'o-1', TENANT]);
  assert.deepEqual(statements(/UPDATE orders SET linked_transfer_id/)[0].params, ['tr-4', 'o-1', TENANT]);
});

test('linking an order to a transfer: the transfer must exist in the tenant and confirm nothing else, and nothing is written when it does not', async () => {
  const row = { id: 'o-1', status: 'pending', branch_id: 'branch-daqqi', subscriber_id: 'sub-1', assigned_sales_id: null, assigned_cs_id: null };
  const patch = linked => run(router, 'PATCH', ONE, { as: ACCOUNTANT, params: { id: 'o-1' }, body: { status: 'pending', linked_transfer_id: linked }, harness: h });
  const orderRule = [/FROM orders o\s+LEFT JOIN subscribers s/, [row]];

  answerWith([orderRule, [/FROM incoming_transfers/, []]]);
  assert.equal((await patch('made-up')).status, 404, 'an id that is no transfer of this tenant');
  assert.deepEqual(statements(/FROM incoming_transfers/)[0].params, [TENANT, ['made-up']], 'looked up inside the tenant');
  assert.equal(wrote().length, 0);
  assert.ok(h.state.transactions.includes('rollback'));

  h.calls.length = 0;
  answerWith([orderRule, [/FROM incoming_transfers/, [{ id: 'tr-1', payment_id: 'pay-9' }]]]);
  assert.equal((await patch('tr-1')).status, 409, 'a transfer that already confirms a payment');
  assert.equal(wrote().length, 0);

  h.calls.length = 0;
  answerWith([orderRule, [/FROM incoming_transfers/, [{ id: 'tr-2', payment_id: null }]], [/SELECT id FROM orders WHERE linked_transfer_id/, [{ id: 'o-7' }]]]);
  assert.equal((await patch('tr-2')).status, 409, 'a transfer another order already carries');
  assert.equal(wrote().length, 0);

  h.calls.length = 0;
  answerWith([orderRule, [/FROM incoming_transfers/, [{ id: 'tr-3', payment_id: null }]]]);
  assert.equal((await patch('tr-3')).status, 200);
  assert.deepEqual(statements(/UPDATE orders SET linked_transfer_id/)[0].params, ['tr-3', 'o-1', TENANT]);

  h.calls.length = 0;
  answerWith([orderRule]);
  assert.equal((await patch(null)).status, 200, 'an empty value clears the link without a lookup');
  assert.equal(statements(/FROM incoming_transfers/).length, 0);
  assert.deepEqual(statements(/UPDATE orders SET linked_transfer_id/)[0].params, [null, 'o-1', TENANT]);
});

test('archiving an order never touches one with money against it, and archives order and payment rows by id inside the tenant otherwise', async () => {
  const del = () => run(router, 'DELETE', ONE, { as: 'owner', params: { id: 'o-1' }, harness: h });
  answerWith([]);
  assert.equal((await del()).status, 404);

  answerWith([[/FROM orders WHERE id=\?/, [{ id: 'o-1', status: 'PAID' }]]]);
  const paid = await del();
  assert.equal(paid.status, 409);
  answerWith([[/FROM payments WHERE id=\?/, [{ id: 'o-1', status: 'paid', amount: 10, subscriber_id: 's' }]]]);
  assert.equal((await del()).status, 409, 'nor an order that is only a paid payment row');
  assert.equal(wrote().length, 0);

  answerWith([[/FROM orders WHERE id=\?/, [{ id: 'o-1', status: 'PENDING' }]]]);
  const ok = await del();
  assert.equal(ok.status, 200);
  assert.deepEqual(statements(/UPDATE orders SET deleted_at/)[0].params, ['o-1', TENANT]);
  assert.equal(statements(/DELETE FROM orders/).length, 0, 'archived, not removed');
});

test('abandoned checkouts bound the look-back hours between 1 and 720 and carry the tenant', async () => {
  for (const [given, used] of [[undefined, 2], ['0', 2], ['-5', 1], ['5', 5], ['100000', 720]]) {
    h.calls.length = 0;
    await run(router, 'GET', ABANDONED, { as: 'owner', query: { hours: given }, harness: h });
    assert.deepEqual(h.calls[0].params, [TENANT, used], `hours=${given}`);
  }
});

test('a client reads only their own orders: those linked to them, and unlinked ones carrying their own email', async () => {
  assert.equal((await run(router, 'GET', MINE, { as: 'anonymous', harness: h })).status, 401);
  answerWith([[/FROM subscribers/, [{ id: 'sub-7', email: 'Client@Unit.Test' }]]]);
  const res = await run(router, 'GET', MINE, { as: 'client', harness: h });
  assert.equal(res.status, 200);
  const orders = statements(/UNION ALL/)[0];
  assert.deepEqual(orders.params, [TENANT, 'sub-7', TENANT, 'client@unit.test']);
  assert.match(orders.sql, /o\.subscriber_id IS NULL AND o\.customer_email=\?/, 'an email only matches orders nobody else has claimed');
  assert.match(orders.sql, /LIMIT 100/);
});
