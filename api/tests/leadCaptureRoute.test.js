'use strict';
// The public lead forms and the CRM settings / distribution routes (routes/lead-capture-crm.js) through their real middleware and handlers on
// a recording database: what an anonymous visitor may and may not put on a lead, that a repeat submission by the same number adds to the
// lead instead of duplicating it, that the branch the visitor chose is honoured, and who may read, change and run the distribution.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
// Where the visitor is comes from a geo lookup over the network; the answer is given here.
const clientContext = require('../lib/clientContext');
let location = { locationResolved: true, branch: 'ONLINE_EGYPT', countryCode: 'EG' };
clientContext.resolveClientContext = async () => location;
const triggered = [];
require('../lib/lifecycle').trigger = async (event, payload) => { triggered.push({ event, payload }); };
const metaCapi = require('../lib/metaCapi');
metaCapi.trackLead = async () => {};
const router = require('../routes/lead-capture-crm');
after(() => setTimeout(() => process.exit(), 300).unref());

const perms = (...list) => JSON.stringify(list);
const REP = { id: 'st-rep', role: 'SALES', data_scope: 'assigned_sales', permissions_json: perms('view_leads') };
const NO_LEADS = { id: 'st-x', role: 'SALES', data_scope: 'assigned_sales', permissions_json: '[]' };

const REGISTER = '/api/registrations';
const PUBLIC = '/api/leads-public';
const SETTINGS = '/api/admin/crm-settings';
const DISTRIBUTE = '/api/admin/leads/distribute';

const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
const answerWith = rules => { h.state.answer = sql => { for (const [pattern, rows] of rules) if (pattern.test(sql)) return rows; return undefined; }; };
const wrote = () => statements(/^(INSERT|UPDATE|DELETE)/);
const register = body => run(router, 'POST', REGISTER, { as: 'anonymous', body, harness: h });
const GET_LOCK = [/GET_LOCK/, [{ acquired: 1 }]];
const COUNTER = [/SELECT next_value FROM client_code_counter/, [{ next_value: 10043 }]];
test.beforeEach(() => {
  h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; triggered.length = 0;
  location = { locationResolved: true, branch: 'ONLINE_EGYPT', countryCode: 'EG' };
  answerWith([GET_LOCK, COUNTER]);
});

test('a registration needs a name and a phone, and a field of the wrong type is refused, not turned into text', async () => {
  assert.equal((await register({ name: 'Hala' })).status, 400);
  assert.equal((await register({ phone: '01012345678' })).status, 400);
  assert.equal((await register({ name: '   ', phone: '01012345678' })).status, 400);
  const object = await register({ name: { $ne: null }, phone: '01012345678' });
  assert.ok(object.status === 400, `an object as the name answered ${object.status}`);
  assert.equal(wrote().length, 0);
});

test('a visitor whose country cannot be verified is not filed, so the lead never lands under a guessed branch', async () => {
  location = { locationResolved: false };
  const res = await register({ name: 'Hala', phone: '01012345678' });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'LOCATION_UNAVAILABLE');
  assert.equal(statements(/INSERT INTO leads/).length, 0);
});

test('a new visitor becomes a new lead in the tenant, under the branch they chose, with a client code, and the welcome is triggered after the commit', async () => {
  const res = await register({ name: '  Hala  ', phone: '01012345678', email: 'HALA@X.TEST', branch: 'daqqi', source: 'site form' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.id);
  assert.equal(res.body.clientCode, 'C10042', 'the next code of the institute counter');
  const insert = statements(/INSERT INTO leads/)[0];
  const [id, tenant, , name, email, phone, source, status, , branch, branchId] = insert.params;
  assert.equal(id, res.body.id);
  assert.equal(tenant, TENANT);
  assert.equal(name, 'Hala', 'the name is trimmed');
  assert.equal(email, 'hala@x.test', 'the email is lower-cased');
  assert.equal(phone, '01012345678');
  assert.equal(source, 'site form');
  assert.equal(status, 'new');
  assert.equal(branch, 'DAQQI', 'the branch the visitor picked wins over the one their address implies');
  assert.equal(branchId, 'branch-daqqi');
  assert.deepEqual(h.state.transactions.filter(t => t !== 'release'), ['begin', 'commit']);
  assert.deepEqual(triggered.map(t => t.event), ['lead_created']);
  assert.ok(statements(/RELEASE_LOCK/).length === 1, 'the per-number lock is released');
});

test('with no branch picked, the branch of the visitor\'s country is used', async () => {
  location = { locationResolved: true, branch: 'ONLINE_SAUDI', countryCode: 'SA' };
  await register({ name: 'Hala', phone: '0501234567' });
  assert.equal(statements(/INSERT INTO leads/)[0].params[9], 'ONLINE_SAUDI');
});

test('a form cannot write a stage, a payment flag or an assignee onto a lead; only the fields a public form may carry are kept', async () => {
  await register({
    name: 'Hala', phone: '01012345678', stage: 'paid', isPaid: true, assignedSalesId: 'st-boss',
    enrolledCourseId: 'c-1', leadType: 'course', preferredPaymentType: 'installment', interestedCourseIds: ['c-1', 'c-2'],
  });
  const crm = JSON.parse(statements(/INSERT INTO leads/)[0].params[13]);
  assert.equal(crm.stage, undefined);
  assert.equal(crm.isPaid, undefined);
  assert.notEqual(crm.assignedSalesId, 'st-boss');
  assert.equal(crm.enrolledCourseId, 'c-1');
  assert.equal(crm.leadType, 'course');
  assert.equal(crm.preferredPaymentType, 'installment');
  assert.deepEqual(crm.interestedCourseIds, ['c-1', 'c-2']);

  h.calls.length = 0;
  await register({ name: 'Hala', phone: '01012345678', leadType: 'vip', preferredPaymentType: 'free' });
  const crm2 = JSON.parse(statements(/INSERT INTO leads/)[0].params[13]);
  assert.equal(crm2.leadType, undefined, 'an unknown lead type is dropped');
  assert.equal(crm2.preferredPaymentType, undefined);
});

test('the same number submitting again reuses the lead, its code and its rep, and appends the new note instead of replacing anything', async () => {
  answerWith([GET_LOCK, [/FROM leads\s+WHERE tenant_id=\?/, [{
    id: 'lead-1', client_code: 'C-77', crm_json: JSON.stringify({ interestedCourseIds: ['c-1'], branch: 'DAQQI' }), assigned_sales_id: 'st-rep', assigned_sales_name: 'Rep',
  }]]]);
  const res = await register({ name: 'Hala', phone: '01012345678', notes: 'wants evening classes', interestedCourseIds: ['c-2'] });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.id, res.body.clientCode], ['lead-1', 'C-77']);
  const lookup = statements(/FROM leads\s+WHERE tenant_id=\?/)[0];
  assert.equal(lookup.params[0], TENANT);
  // A hidden or archived lead holds the number too (unique key on tenant + phone): it is matched, a visible one first.
  assert.doesNotMatch(lookup.sql, /hidden=0/);
  assert.match(lookup.sql, /ORDER BY hidden ASC/);
  assert.match(lookup.sql, /merged_into_lead_id IS NULL/);
  assert.match(lookup.sql, /FOR UPDATE/);
  const insert = statements(/INSERT INTO leads/)[0];
  assert.match(insert.sql, /ON DUPLICATE KEY UPDATE/);
  assert.match(insert.sql, /CONCAT\(notes/, 'a new note is appended');
  assert.match(insert.sql, /name=COALESCE\(NULLIF\(name,''\)/, 'the name the desk has is kept');
  assert.equal(insert.params[11], 'st-rep', 'the lead keeps its rep');
  assert.deepEqual(JSON.parse(insert.params[13]).interestedCourseIds, ['c-1', 'c-2'], 'interests are merged, not replaced');
  assert.equal(triggered.length, 0, 'an existing lead is not welcomed twice');
});

test('a registration being processed for the same number answers 409 and writes nothing', async () => {
  answerWith([[/GET_LOCK/, [{ acquired: 0 }]]]);
  const res = await register({ name: 'Hala', phone: '01012345678' });
  assert.equal(res.status, 409);
  assert.equal(wrote().length, 0);
  assert.ok(!h.state.transactions.includes('begin'));
});

test('a database failure answers 500 without the error text, rolls back, and still releases the lock', async () => {
  h.state.answer = sql => { if (/GET_LOCK/.test(sql)) return [{ acquired: 1 }]; if (/INSERT INTO leads/.test(sql)) throw new Error('ER_SECRET table detail'); return undefined; };
  const res = await register({ name: 'Hala', phone: '01012345678' });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'Internal server error' });
  assert.ok(h.state.transactions.includes('rollback'));
  assert.equal(statements(/RELEASE_LOCK/).length, 1);
});

test('the lighter public form needs a name and a phone too', async () => {
  const bad = await run(router, 'POST', PUBLIC, { as: 'anonymous', body: { name: 'Hala' }, harness: h });
  assert.equal(bad.status, 400);
  assert.equal(wrote().length, 0);
});

test('CRM settings: any rep with view_leads reads them, only an administrator changes them, and they are read and written inside the tenant', async () => {
  assert.equal((await run(router, 'GET', SETTINGS, { as: 'anonymous', harness: h })).status, 401);
  assert.equal((await run(router, 'GET', SETTINGS, { as: NO_LEADS, harness: h })).status, 403);
  answerWith([[/FROM tenant_settings/, [{ config_json: JSON.stringify({ stages: ['new'] }) }]]]);
  const read = await run(router, 'GET', SETTINGS, { as: REP, harness: h });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { stages: ['new'] });
  assert.deepEqual(h.calls[0].params, [TENANT, 'crm_settings']);

  h.calls.length = 0;
  assert.equal((await run(router, 'PUT', SETTINGS, { as: REP, body: { stages: [] }, harness: h })).status, 403);
  assert.equal(wrote().length, 0, 'a rep cannot rewrite the CRM settings');
  const saved = await run(router, 'PUT', SETTINGS, { as: 'owner', body: { stages: ['a', 'b'] }, harness: h });
  assert.equal(saved.status, 200);
  const upsert = statements(/INSERT INTO tenant_settings/)[0];
  assert.equal(upsert.params[1], TENANT);
  assert.equal(upsert.params[2], 'crm_settings');
  assert.deepEqual(JSON.parse(upsert.params[3]), { stages: ['a', 'b'] });
});

test('distribution is for administrators; it takes a lock per tenant, refuses to run twice at once, and with nobody enabled hands out nothing', async () => {
  assert.equal((await run(router, 'POST', DISTRIBUTE, { as: 'anonymous', body: {}, harness: h })).status, 401);
  assert.equal((await run(router, 'POST', DISTRIBUTE, { as: REP, body: {}, harness: h })).status, 403);
  assert.equal(wrote().length, 0);

  answerWith([[/GET_LOCK/, [{ acquired: 0 }]]]);
  const busy = await run(router, 'POST', DISTRIBUTE, { as: 'owner', body: {}, harness: h });
  assert.equal(busy.status, 409);
  assert.deepEqual(statements(/GET_LOCK/)[0].params, [`crm-distribute:${TENANT}`]);
  assert.equal(statements(/UPDATE leads/).length, 0);

  h.calls.length = 0; h.state.transactions.length = 0;
  answerWith([GET_LOCK, [/FROM leads WHERE hidden=0/, [{ id: 'l-1', source: 'site', interested_course_ids_json: null, crm_json: null }]]]);
  const nobody = await run(router, 'POST', DISTRIBUTE, { as: 'owner', body: {}, harness: h });
  assert.equal(nobody.status, 409);
  assert.equal(nobody.body.assigned, 0);
  assert.equal(statements(/UPDATE leads SET assigned_sales_id/).length, 0, 'no lead is assigned when no rep is switched on');
  assert.ok(!h.state.transactions.includes('begin'), 'and no transaction is opened, so nothing is locked');
  assert.equal(statements(/RELEASE_LOCK/).length, 1, 'the tenant lock is released');
});

test('the distribution pool excludes terminal statuses and, unless asked for all, leads that already have an owner', async () => {
  // One rep is switched on, so the pool is read (in a chunk of its own: bounded, locked for the chunk's transaction only).
  answerWith([GET_LOCK, COUNTER, [/FROM staff s LEFT JOIN crm_assignment_members/, [{ id: 'rep-1', name: 'رامي', policy_id: null }]], [/SELECT COUNT\(\*\) AS n FROM leads/, [{ n: 0 }]]]);
  await run(router, 'POST', DISTRIBUTE, { as: 'owner', body: { mode: 'unassigned' }, harness: h });
  const pool = statements(/FROM leads WHERE hidden=0/)[0];
  assert.match(pool.sql, /assigned_sales_id IS NULL/);
  assert.match(pool.sql, /LIMIT \? OFFSET \? FOR UPDATE/);
  assert.equal(pool.params[0], TENANT);
  assert.ok(!pool.params.includes('converted') && !pool.params.includes('lost'), 'closed leads are not handed out again');
  assert.equal(pool.params.at(-2), 250, 'a chunk, not the whole pool');

  h.calls.length = 0;
  await run(router, 'POST', DISTRIBUTE, { as: 'owner', body: { mode: 'all' }, harness: h });
  assert.doesNotMatch(statements(/FROM leads WHERE hidden=0/)[0].sql, /assigned_sales_id IS NULL/);
});
