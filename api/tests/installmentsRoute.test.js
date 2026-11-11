'use strict';
// Instalment plans through their real guards and handlers on a recording database: who may create, read, pay and delete a plan,
// what a plan is stored as (amounts as numbers, tenant on every statement), and what confirming an instalment refuses.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
delete process.env.INSTALLMENT_WRITES_ENABLED;
const h = install();
const router = require('../routes/installments');
after(() => setTimeout(() => process.exit(), 200).unref());

const ACCOUNTS = { id: 'st-acc', role: 'ACCOUNTANT', data_scope: 'all', permissions_json: JSON.stringify(['manage_financial', 'view_financial']) };
const VIEWER = { id: 'st-view', role: 'ACCOUNTANT', data_scope: 'all', permissions_json: JSON.stringify(['view_financial']) };
const CS_OWN = { id: 'st-cs', role: 'CS', data_scope: 'assigned_cs', permissions_json: JSON.stringify(['manage_financial', 'view_financial']) };

const PLAN_PATH = '/api/admin/subscribers/:subscriberId/installment-plans';
const PAY_PATH = '/api/admin/installment-plans/:planId/entries/:index/pay';
const PLAN_DEL = '/api/admin/installment-plans/:planId';
const ENTRY_DEL = '/api/admin/installment-plans/:planId/entries/:index';

const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
const SUBSCRIBER = { id: 'sub-1', branch_id: 'branch-daqqi', assigned_cs_id: 'st-cs', assigned_sales_id: null };
const plan = (over = {}) => ({
  id: 'plan-1', tenant_id: TENANT, subscriber_id: 'sub-1', course_id: 'c-1', bundle_id: null, title: 'Track', currency: 'EGP',
  total_amount: 3000, installments_count: 3, paid_count: 0, installment_amounts: '[1000,1000,1000]',
  due_dates: '["2026-11-01","2026-12-01","2027-01-01"]', paid_dates: '[null,null,null]', payment_ids: '[null,null,null]', paid_amounts: '[null,null,null]',
  branch: 'DAQQI', branch_id: 'branch-daqqi', assigned_cs_id: 'st-cs', assigned_sales_id: null, subscriber_phone: '01012345678', ...over,
});
const answerWith = rules => {
  h.state.answer = sql => {
    for (const [pattern, rows] of rules) if (pattern.test(sql)) return rows;
    return undefined;
  };
};
test.beforeEach(() => { h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; answerWith([]); });

test('every instalment route needs a signed-in staff member with the right permission', async () => {
  const routes = [
    ['POST', PLAN_PATH, { subscriberId: 'sub-1' }], ['GET', PLAN_PATH, { subscriberId: 'sub-1' }],
    ['POST', PAY_PATH, { planId: 'plan-1', index: '0' }], ['DELETE', PLAN_DEL, { planId: 'plan-1' }], ['DELETE', ENTRY_DEL, { planId: 'plan-1', index: '0' }],
  ];
  for (const [method, path, params] of routes) {
    assert.equal((await run(router, method, path, { as: 'anonymous', params, body: {}, harness: h })).status, 401, `${method} ${path} anonymous`);
    assert.equal((await run(router, method, path, { as: 'client', params, body: {}, harness: h })).status, 403, `${method} ${path} client`);
  }
  // Reading needs view_financial; writing needs manage_financial, which a viewer lacks.
  for (const [method, path, params] of routes.filter(([m]) => m !== 'GET')) {
    const res = await run(router, method, path, { as: VIEWER, params, body: { entries: [{ amount: 1 }], totalAmount: 1 }, harness: h });
    assert.equal(res.status, 403, `${method} ${path} viewer`);
    assert.match(res.body.error, /manage_financial/);
  }
  assert.equal(h.calls.length, 0, 'no refusal reached the database');
});

test('the owner can switch instalment writes off; reads stay open', async () => {
  process.env.INSTALLMENT_WRITES_ENABLED = 'false';
  try {
    const res = await run(router, 'POST', PLAN_PATH, { as: 'owner', params: { subscriberId: 'sub-1' }, body: { totalAmount: 100, entries: [{ amount: 100 }] }, harness: h });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'INSTALLMENT_WRITES_DISABLED');
    assert.equal(h.calls.length, 0);
  } finally { delete process.env.INSTALLMENT_WRITES_ENABLED; }
});

test('creating a plan rejects a missing schedule and a non-positive total before reading anything', async () => {
  for (const body of [{ totalAmount: 100 }, { totalAmount: 100, entries: [] }, { totalAmount: 0, entries: [{ amount: 1 }] }, { totalAmount: -5, entries: [{ amount: 1 }] }, { totalAmount: 'abc', entries: [{ amount: 1 }] }]) {
    const res = await run(router, 'POST', PLAN_PATH, { as: ACCOUNTS, params: { subscriberId: 'sub-1' }, body, harness: h });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(h.calls.length, 0);
});

test('a plan for a subscriber outside the caller\'s scope answers 404 and writes nothing', async () => {
  answerWith([[/FROM subscribers/, [SUBSCRIBER]]]);
  const res = await run(router, 'POST', PLAN_PATH, {
    as: { ...CS_OWN, id: 'st-someone-else' }, params: { subscriberId: 'sub-1' }, body: { totalAmount: 100, entries: [{ amount: 100 }] }, harness: h,
  });
  assert.equal(res.status, 404);
  assert.deepEqual(h.calls[0].params, ['sub-1', TENANT], 'the subscriber is looked up inside the tenant');
  assert.equal(statements(/INSERT/).length, 0);
});

test('creating a plan stores the amounts as numbers, the schedule as JSON, and the tenant, then rebuilds its entry rows', async () => {
  answerWith([[/FROM subscribers/, [SUBSCRIBER]]]);
  const res = await run(router, 'POST', PLAN_PATH, {
    as: ACCOUNTS, params: { subscriberId: 'sub-1' }, harness: h,
    body: { courseId: 'c-1', title: 'Track', totalAmount: '3000.50', currency: 'SAR', notes: 'n', entries: [{ amount: '1500.25', dueDate: '2026-11-01' }, { amount: '1500.25', dueDate: '2026-12-01' }, { amount: 'junk' }] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.id);
  const insert = statements(/INSERT INTO installment_plans/)[0];
  assert.ok(insert);
  const [id, tenant, subscriber, course, bundle, title, total, currency, count, amounts, dueDates, paidDates] = insert.params;
  assert.equal(id, res.body.id);
  assert.equal(tenant, TENANT);
  assert.equal(subscriber, 'sub-1');
  assert.equal(course, 'c-1'); assert.equal(bundle, null); assert.equal(title, 'Track');
  assert.strictEqual(total, 3000.5, 'a total sent as text is stored as a number');
  assert.equal(currency, 'SAR');
  assert.equal(count, 3);
  assert.deepEqual(JSON.parse(amounts), [1500.25, 1500.25, 0], 'an unreadable amount becomes 0, never NaN or text');
  assert.deepEqual(JSON.parse(dueDates), ['2026-11-01', '2026-12-01', null]);
  assert.deepEqual(JSON.parse(paidDates), [null, null, null], 'a new plan has nothing paid');
  assert.ok(statements(/DELETE FROM installment_entries WHERE plan_id/).length === 1, 'the entry rows are rebuilt');
});

test('a collection officer can only schedule what is left of the agreed price, in its currency', async () => {
  answerWith([
    [/FROM subscribers/, [{ ...SUBSCRIBER, assigned_cs_id: 'st-coll' }]],
  ]);
  const collection = { id: 'st-coll', role: 'COLLECTION', data_scope: 'assigned_cs', permissions_json: JSON.stringify(['manage_financial']) };
  const res = await run(router, 'POST', PLAN_PATH, {
    as: collection, params: { subscriberId: 'sub-1' }, harness: h,
    body: { courseId: 'c-1', totalAmount: 100, currency: 'EGP', entries: [{ amount: 100, dueDate: '2026-11-01' }] },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'COLLECTION_PRICE_LOCKED');
  assert.equal(statements(/INSERT INTO installment_plans/).length, 0);
});

test('listing plans is scoped to the tenant and the subscriber, and a record outside the caller\'s data scope is 404', async () => {
  answerWith([
    [/FROM subscribers/, [SUBSCRIBER]],
    [/FROM installment_plans/, [plan()]],
  ]);
  const ok = await run(router, 'GET', PLAN_PATH, { as: ACCOUNTS, params: { subscriberId: 'sub-1' }, harness: h });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.length, 1);
  assert.deepEqual(statements(/FROM installment_plans/)[0].params, ['sub-1', TENANT]);

  h.calls.length = 0;
  const outside = await run(router, 'GET', PLAN_PATH, { as: { ...CS_OWN, id: 'st-other' }, params: { subscriberId: 'sub-1' }, harness: h });
  assert.equal(outside.status, 404);
  assert.equal(statements(/FROM installment_plans/).length, 0, 'the plans of a client the caller does not own are not read');
});

test('confirming an instalment needs the box it went into', async () => {
  const res = await run(router, 'POST', PAY_PATH, { as: ACCOUNTS, params: { planId: 'plan-1', index: '0' }, body: { amount: 1000, paymentMethod: '  ' }, harness: h });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /paymentMethod/);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.state.transactions, ['release'], 'no transaction began, and the connection taken was handed back');
});

test('confirming an instalment: an unknown plan, a plan outside scope and a client without a real phone are refused and rolled back', async () => {
  const body = { amount: 1000, paymentMethod: 'cash' };
  answerWith([[/FROM installment_plans ip/, []]]);
  const none = await run(router, 'POST', PAY_PATH, { as: ACCOUNTS, params: { planId: 'plan-x', index: '0' }, body, harness: h });
  assert.equal(none.status, 404);
  assert.deepEqual(h.calls[0].params, ['plan-x', TENANT]);
  assert.ok(h.state.transactions.includes('rollback'));

  answerWith([[/FROM installment_plans ip/, [plan()]]]);
  const outside = await run(router, 'POST', PAY_PATH, { as: { ...CS_OWN, id: 'st-other' }, params: { planId: 'plan-1', index: '0' }, body, harness: h });
  assert.equal(outside.status, 404);

  answerWith([[/FROM installment_plans ip/, [plan({ subscriber_phone: '000' })]]]);
  const phone = await run(router, 'POST', PAY_PATH, { as: ACCOUNTS, params: { planId: 'plan-1', index: '0' }, body, harness: h });
  assert.equal(phone.status, 400);
  assert.equal(phone.body.code, 'PHONE_REQUIRED');
  assert.equal(statements(/INSERT INTO payments/).length, 0, 'no money was recorded in any of the three');
});

test('confirming refuses a non-positive amount, an index outside the plan and an instalment already paid', async () => {
  const pay = (index, amount) => run(router, 'POST', PAY_PATH, { as: ACCOUNTS, params: { planId: 'plan-1', index }, body: { amount, paymentMethod: 'cash' }, harness: h });
  answerWith([[/FROM installment_plans ip/, [plan()]]]);
  assert.equal((await pay('0', 0)).status, 400);
  assert.equal((await pay('0', -50)).status, 400);
  assert.equal((await pay('0', 'abc')).status, 400);
  assert.equal((await pay('7', 100)).status, 400);
  assert.equal((await pay('x', 100)).status, 400);
  answerWith([[/FROM installment_plans ip/, [plan({ paid_dates: '["2026-11-01",null,null]', paid_count: 1 })]]]);
  assert.equal((await pay('0', 1000)).status, 409);
  assert.equal(statements(/INSERT INTO payments/).length, 0);
});

test('a plan with a payment against it cannot be deleted; one with none is deleted with its entry rows, inside the tenant', async () => {
  answerWith([[/SELECT ip.paid_count/, [{ paid_count: 1, ...SUBSCRIBER }]]]);
  const paid = await run(router, 'DELETE', PLAN_DEL, { as: ACCOUNTS, params: { planId: 'plan-1' }, harness: h });
  assert.equal(paid.status, 409);
  assert.equal(statements(/DELETE FROM installment_plans/).length, 0);

  answerWith([[/SELECT ip.paid_count/, [{ paid_count: 0, ...SUBSCRIBER }]]]);
  const clear = await run(router, 'DELETE', PLAN_DEL, { as: ACCOUNTS, params: { planId: 'plan-1' }, harness: h });
  assert.equal(clear.status, 200);
  const del = statements(/DELETE FROM installment_plans/)[0];
  assert.match(del.sql, /paid_count=0/, 'the delete re-checks that nothing was paid meanwhile');
  assert.deepEqual(del.params, ['plan-1', TENANT]);

  answerWith([[/SELECT ip.paid_count/, []]]);
  assert.equal((await run(router, 'DELETE', PLAN_DEL, { as: ACCOUNTS, params: { planId: 'nope' }, harness: h })).status, 404);
});

test('removing one unpaid entry re-totals the plan; a paid entry cannot be removed', async () => {
  answerWith([[/SELECT ip\.\*, s\.branch_id/, [plan({ installment_amounts: '[1000.10,1000.20,1000.30]' })]]]);
  const ok = await run(router, 'DELETE', ENTRY_DEL, { as: ACCOUNTS, params: { planId: 'plan-1', index: '1' }, harness: h });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const update = statements(/UPDATE installment_plans SET installment_amounts/)[0];
  assert.deepEqual(JSON.parse(update.params[0]), [1000.1, 1000.3]);
  assert.equal(update.params[5], 2, 'the count follows');
  assert.ok(Math.abs(update.params[6] - 2000.4) < 1e-9, 'the total is the sum of what is left');
  assert.deepEqual(update.params.slice(7), ['plan-1', TENANT]);

  h.calls.length = 0;
  answerWith([[/SELECT ip\.\*, s\.branch_id/, [plan({ paid_dates: '["2026-11-01",null,null]', paid_amounts: '[1000,null,null]' })]]]);
  const paid = await run(router, 'DELETE', ENTRY_DEL, { as: ACCOUNTS, params: { planId: 'plan-1', index: '0' }, harness: h });
  assert.equal(paid.status, 409);
  assert.equal(statements(/UPDATE installment_plans/).length, 0);
});
