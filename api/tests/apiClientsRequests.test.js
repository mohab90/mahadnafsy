'use strict';
/**
 * How the two browser API clients (admin/lib/mysqlapi.ts, client/lib/mysqlapi.ts) send their requests, run for real against a fetch that
 * answers as told (bundled with the admin's esbuild; see support/repo.js `bundle`): identical reads in flight share one request and a settled one
 * is not served again; a write is never shared and never repeated; a read that hit a server restart (502), an unreachable host (TypeError) or a
 * request that ran past its timeout (AbortError) is sent once more and the person sees the answer of the second try.
 * (These were regular expressions over the two files' source.)
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { bundle } = require('./support/repo');

global.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
global.window = Object.assign(global.window || {}, { addEventListener() {}, removeEventListener() {}, location: { pathname: '/', href: '/', assign() {} }, dispatchEvent() {} });

const probe = bundle('admin/lib/mysqlapi.ts');
const skip = !probe && 'admin dependencies are not installed here';

const CLIENTS = skip ? [] : [
  ['admin', probe, module => path => module.mysqlAdmin.adminGet(path), module => path => module.mysqlAdmin.adminPost(path, {})],
  ['client', bundle('client/lib/mysqlapi.ts'), module => () => module.mysqlClient.getMySubscriber(), module => () => module.mysqlForms.submitJoinUs({})],
];

let calls; let script;
const ok = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
const status = code => ({ ok: false, status: code, headers: { get: () => null }, json: async () => ({ error: `HTTP ${code}` }) });
const aborted = () => Object.assign(new DOMException('timeout', 'AbortError'));
beforeEach(() => {
  calls = [];
  script = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    const next = script.length ? script.shift() : ok({ n: calls.length });
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next();
    return next;
  };
});

for (const [name, module, getOf, postOf] of CLIENTS) {
  const get = getOf(module); const post = postOf(module);
  const path = name === 'admin' ? '/admin/sales-targets' : '/me/subscriber';

  test(`${name}: two identical reads in flight make one request, and a finished read is asked again`, { skip }, async () => {
    const [a, b] = await Promise.all([get(path), get(path)]);
    assert.equal(calls.length, 1, 'one request for the pair');
    assert.deepEqual(a, b);
    await get(path);
    assert.equal(calls.length, 2, 'the entry is dropped when the first settles: this is not a cache');
  });

  test(`${name}: two identical writes in flight are two requests`, { skip }, async () => {
    await Promise.all([post('/admin/notes'), post('/admin/notes')]);
    assert.equal(calls.filter(call => call.method === 'POST').length, 2);
  });

  test(`${name}: a read that hit a server restart is sent once more`, { skip }, async () => {
    script = [status(503), ok({ fine: true })];
    assert.deepEqual(await get(path), { fine: true });
    assert.equal(calls.length, 2);
  });

  test(`${name}: a read that timed out (AbortError) or could not connect (TypeError) is sent once more`, { skip }, async () => {
    script = [aborted(), ok({ slow: 'but here' })];
    assert.deepEqual(await get(path), { slow: 'but here' });
    assert.equal(calls.length, 2, 'the slow server is the case most likely to answer the second time');
    calls.length = 0;
    script = [new TypeError('Failed to fetch'), ok({ back: true })];
    assert.deepEqual(await get(`${path}?again=1`), { back: true });
    assert.equal(calls.length, 2);
  });

  test(`${name}: a write that lost its answer is never sent again`, { skip }, async () => {
    script = [aborted()];
    await assert.rejects(post('/admin/payments'));
    assert.equal(calls.length, 1, 'it may well have been recorded: the person decides');
    calls.length = 0;
    script = [status(502)];
    await assert.rejects(post('/admin/payments'));
    assert.equal(calls.length, 1);
  });
}
