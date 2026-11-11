'use strict';
// Certificate requests through their real guards and handlers on a recording database: who may open the desk and who may correct prices,
// that a request is only opened for a client with a full enrolment and a finished course, that the price comes from the tenant's list in the
// currency of the client's group (or is typed by a manager and stays a decimal), and what the identity-data and detail edits refuse.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/certificates');
after(() => setTimeout(() => process.exit(), 300).unref());

const perms = (...list) => JSON.stringify(list);
const DESK = { id: 'st-cert', role: 'SUPPORT', data_scope: 'all', name: 'Desk', permissions_json: perms('manage_certificates') };
const MANAGER = { id: 'st-mgr', role: 'MANAGER', data_scope: 'all', name: 'Mgr', permissions_json: perms('manage_certificates') };
const COLLECTION = { id: 'st-coll', role: 'COLLECTION', data_scope: 'assigned_cs', name: 'Coll', permissions_json: perms('manage_financial') };

const LIST = '/api/admin/certificate-requests';
const AUDIT = '/api/admin/certificate-requests/audit';
const FIX = '/api/admin/certificate-requests/audit/fix';
const CLIENT_DATA = '/api/admin/certificate-requests/:id/client-data';
const DETAILS = '/api/admin/certificate-requests/:id/details';

const PRICE_LIST = JSON.stringify({ ain_shams: { egyptianEGP: 1500.5, residentEGP: 2500, residentSAR: 400, foreignUSD: 120 } });
const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
const answerWith = rules => {
  h.state.answer = sql => {
    for (const [pattern, rows] of rules) if (pattern.test(sql)) return rows;
    return /FROM tenant_settings/.test(sql) ? [{ config_json: JSON.stringify({ extra_cert_pricing: PRICE_LIST }) }] : undefined;
  };
};
const wrote = () => statements(/^(INSERT|UPDATE|DELETE)/);
test.beforeEach(() => { h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; answerWith([]); });

test('the certificates desk needs manage_certificates; the price review and its fix are for managers; client data also opens to the collection desk', async () => {
  for (const [method, path] of [['GET', LIST], ['POST', LIST], ['GET', AUDIT], ['POST', FIX], ['PUT', DETAILS], ['PUT', CLIENT_DATA]]) {
    assert.equal((await run(router, method, path, { as: 'anonymous', params: { id: 'cr-1' }, body: {}, harness: h })).status, 401, `${method} ${path}`);
    assert.equal((await run(router, method, path, { as: 'client', params: { id: 'cr-1' }, body: {}, harness: h })).status, 403, `${method} ${path} client`);
  }
  for (const [method, path] of [['GET', AUDIT], ['POST', FIX], ['PUT', DETAILS]]) {
    const res = await run(router, method, path, { as: DESK, params: { id: 'cr-1' }, body: { ids: ['cr-1'] }, harness: h });
    assert.equal(res.status, 403, `${method} ${path} for a desk clerk`);
    assert.match(res.body.code, /MANAGERS?_ONLY/);
  }
  const collection = await run(router, 'GET', LIST, { as: COLLECTION, harness: h });
  assert.equal(collection.status, 403, 'the collection desk does not read the whole certificate list');
  answerWith([[/FROM certificate_requests WHERE id=\?/, []]]);
  const data = await run(router, 'PUT', CLIENT_DATA, { as: COLLECTION, params: { id: 'cr-1' }, body: {}, harness: h });
  assert.equal(data.status, 404, 'but it may reach a request to complete its client data');
  assert.equal(wrote().length, 0);
});

test('the list is bounded and read inside the tenant', async () => {
  const res = await run(router, 'GET', LIST, { as: DESK, query: { limit: '999999' }, harness: h });
  assert.equal(res.status, 200);
  const select = statements(/FROM certificate_requests cr/)[0];
  assert.ok(select.params.includes(TENANT));
  assert.ok(select.params.every(p => typeof p !== 'number' || p <= 5000), 'the limit is capped at 5,000');
});

test('opening a request needs a client, a course, a known type and a known nationality', async () => {
  const open = body => run(router, 'POST', LIST, { as: DESK, body, harness: h });
  assert.equal((await open({ courseId: 'c-1', type: 'AIN_SHAMS' })).status, 400);
  assert.equal((await open({ subscriberId: 's-1', type: 'AIN_SHAMS' })).status, 400);
  assert.match((await open({ subscriberId: 's-1', courseId: 'c-1', type: 'MADE_UP' })).body.error, /Invalid certificate type/);
  assert.match((await open({ subscriberId: 's-1', courseId: 'c-1', type: 'AIN_SHAMS', nationality: 'MARTIAN' })).body.error, /Invalid nationality/);
  assert.equal(h.state.transactions.length, 0, 'no transaction was opened for any of them');
});

test('a request needs a client with a full enrolment and a finished course, and not another open request of the same type', async () => {
  const body = { subscriberId: 's-1', courseId: 'c-1', type: 'ain_shams', nationality: 'EGYPTIAN' };
  answerWith([[/FROM subscribers s\s+JOIN enrollments e/, []]]);
  const notEligible = await run(router, 'POST', LIST, { as: DESK, body, harness: h });
  assert.equal(notEligible.status, 409);
  assert.deepEqual(statements(/JOIN enrollments e/)[0].params, ['c-1', 's-1', TENANT]);
  assert.ok(h.state.transactions.includes('rollback'));

  answerWith([[/FROM subscribers s\s+JOIN enrollments e/, [{ id: 's-1' }]], [/SELECT id FROM certificate_requests/, [{ id: 'cr-old' }]]]);
  const dup = await run(router, 'POST', LIST, { as: DESK, body, harness: h });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.id, 'cr-old');
  assert.equal(statements(/INSERT INTO certificate_requests/).length, 0);
});

test('the price is the tenant\'s list in the currency of the client\'s group, as a number; a typed price wins and must not be negative', async () => {
  const eligible = [/FROM subscribers s\s+JOIN enrollments e/, [{ id: 's-1' }]];
  const open = body => run(router, 'POST', LIST, { as: DESK, body: { subscriberId: 's-1', courseId: 'c-1', type: 'ain_shams', ...body }, harness: h });

  answerWith([eligible]);
  const egyptian = await open({ nationality: 'EGYPTIAN' });
  assert.equal(egyptian.status, 201, JSON.stringify(egyptian.body));
  assert.deepEqual([egyptian.body.price, egyptian.body.currency, egyptian.body.status], [1500.5, 'EGP', 'priced']);
  const insert = statements(/INSERT INTO certificate_requests/)[0];
  assert.ok(insert.params.includes(TENANT));
  assert.ok(insert.params.includes('AIN_SHAMS'), 'the type is stored in its code form');

  const saudi = await open({ nationality: 'SAUDI_RESIDENT' });
  assert.deepEqual([saudi.body.price, saudi.body.currency], [400, 'SAR']);
  const abroad = await open({ nationality: 'INTERNATIONAL' });
  assert.deepEqual([abroad.body.price, abroad.body.currency], [120, 'USD']);

  const typed = await open({ nationality: 'EGYPTIAN', price: '999.99' });
  assert.strictEqual(typed.body.price, 999.99);
  const free = await open({ nationality: 'EGYPTIAN', price: 0 });
  assert.equal(free.body.status, 'pending', 'a request priced at zero waits for a price');

  h.calls.length = 0;
  answerWith([eligible]);
  for (const price of [-1, 'abc']) assert.equal((await open({ price })).status, 400, `price ${price}`);
  assert.equal((await open({ currency: 'EG' })).status, 400, 'a currency is three letters');
  assert.equal(statements(/INSERT INTO certificate_requests/).length, 0);
});

test('a request of a type the price list does not cover is opened pending, with no price invented', async () => {
  answerWith([[/FROM subscribers s\s+JOIN enrollments e/, [{ id: 's-1' }]]]);
  const res = await run(router, 'POST', LIST, { as: DESK, body: { subscriberId: 's-1', courseId: 'c-1', type: 'INSTITUTE', nationality: 'EGYPTIAN' }, harness: h });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'pending');
  assert.ok(res.body.price === null || res.body.price === 0 || res.body.price === undefined);
});

test('completing a client\'s data refuses a bad Arabic name, English name or national ID and an end date before the start, and writes nothing', async () => {
  const request = { id: 'cr-1', subscriber_id: 's-1', nationality: 'EGYPTIAN', name_ar: null };
  answerWith([[/FROM certificate_requests WHERE id=\?/, [request]]]);
  const put = body => run(router, 'PUT', CLIENT_DATA, { as: DESK, params: { id: 'cr-1' }, body, harness: h });
  assert.equal((await put({ nameAr: 'not arabic 123' })).status, 400);
  assert.equal((await put({ nameEn: 'قلب' })).status, 400);
  const shortId = await put({ idNumber: '1234' });
  assert.equal(shortId.status, 400);
  assert.match(shortId.body.error, /14/);
  const impossible = await put({ idNumber: '29913310101234' });
  assert.equal(impossible.status, 400, 'month 13 is not a birth date');
  const backwards = await put({ courseStartDate: '2026-05-10', courseEndDate: '2026-05-01' });
  assert.equal(backwards.status, 400);
  assert.equal(wrote().length, 0);
  assert.ok(h.state.transactions.includes('rollback'));
});

test('a non-Egyptian\'s passport number is accepted as 5 to 20 letters or digits and stored in capitals, scoped to the tenant', async () => {
  answerWith([[/FROM certificate_requests WHERE id=\?/, [{ id: 'cr-1', subscriber_id: 's-1', nationality: 'SAUDI_RESIDENT', name_ar: null }]]]);
  const res = await run(router, 'PUT', CLIENT_DATA, { as: DESK, params: { id: 'cr-1' }, body: { idNumber: 'ab-123 456' }, harness: h });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const update = statements(/UPDATE certificate_requests\s+SET name_ar=COALESCE/)[0];
  assert.equal(update.params[2], 'AB123456');
  assert.deepEqual(update.params.slice(5), ['cr-1', TENANT]);
});

test('a manager\'s detail edit: unknown type or nationality, a negative or text price, and an amount paid on a payment row are each refused', async () => {
  const request = { id: 'cr-1', subscriber_id: 's-1', type: 'AIN_SHAMS', nationality: 'EGYPTIAN', currency: 'EGP', price: 1500.5, paid_amount: 0, name_ar: 'احمد' };
  answerWith([[/FROM certificate_requests WHERE id=\?/, [request]]]);
  const put = body => run(router, 'PUT', DETAILS, { as: MANAGER, params: { id: 'cr-1' }, body, harness: h });
  assert.equal((await put({ type: 'MADE_UP' })).status, 400);
  assert.equal((await put({ nationality: 'MARTIAN' })).status, 400);
  assert.equal((await put({ price: -3 })).status, 400);
  assert.equal((await put({ price: 'abc' })).status, 400);
  assert.equal(wrote().length, 0);

  answerWith([[/FROM certificate_requests WHERE id=\?/, [request]], [/FROM payments p WHERE p\.certificate_request_id/, [{ id: 'pay-1' }]]]);
  const linked = await put({ paidAmount: 700 });
  assert.equal(linked.status, 409, 'what was paid is edited on the payment that carries it');
  assert.equal(wrote().length, 0);
});

test('changing nothing writes nothing; changing the name writes only that column, inside the tenant', async () => {
  const request = { id: 'cr-1', subscriber_id: 's-1', type: 'AIN_SHAMS', nationality: 'EGYPTIAN', currency: 'EGP', price: 1500.5, paid_amount: 0, name_ar: 'احمد' };
  answerWith([[/FROM certificate_requests WHERE id=\?/, [request]]]);
  const same = await run(router, 'PUT', DETAILS, { as: MANAGER, params: { id: 'cr-1' }, body: { nameAr: 'احمد', type: 'ain_shams' }, harness: h });
  assert.deepEqual(same.body, { ok: true, changed: [] });
  assert.equal(statements(/UPDATE certificate_requests/).length, 0);

  const renamed = await run(router, 'PUT', DETAILS, { as: MANAGER, params: { id: 'cr-1' }, body: { nameAr: 'محمد' }, harness: h });
  assert.equal(renamed.status, 200);
  const update = statements(/UPDATE certificate_requests SET name_ar=\?/)[0];
  assert.deepEqual(update.params, ['محمد', 'cr-1', TENANT]);
});

test('the price fix needs the ids of the requests chosen', async () => {
  const none = await run(router, 'POST', FIX, { as: MANAGER, body: { ids: [] }, harness: h });
  assert.equal(none.status, 400);
  const notArray = await run(router, 'POST', FIX, { as: MANAGER, body: { ids: 'cr-1' }, harness: h });
  assert.equal(notArray.status, 400);
  assert.equal(h.state.transactions.length, 0);
});
