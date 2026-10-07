'use strict';
/**
 * An import on 3 Oct sent 1,731 leads one request each and lost 531 of them:
 * past 400 a minute the rate limiter answered «طلبات كثيرة جدًا», the screen
 * counted each as a failed row, and nobody sent them again. «دمج الكل» did the
 * same on 24 Sep (6,620 refused merges), and a client import on 29 Sep (561).
 *
 * A 429 from the limiter never reached a route, so the admin's API client waits
 * out the limiter's minute and sends it again; the 15-minute login lock is left
 * for the person to read. Runs the admin's own client (bundled with its
 * esbuild); skipped where the admin's packages are not installed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
function load(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const api = load('admin/lib/mysqlapi.ts');

const answer = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function serve(...answers) {
  const calls = [];
  globalThis.localStorage = { getItem: () => null, removeItem() {} };
  globalThis.fetch = async (url, options) => { calls.push({ url, method: options.method }); return answers.shift(); };
  return calls;
}
const limited = seconds => answer(429, { error: 'طلبات كثيرة جدًا، انتظر دقيقة وحاول مرة أخرى', code: 'RATE_LIMITED' }, { 'Retry-After': String(seconds) });

test('a row the rate limiter turned away is sent again once its minute is up', { skip: !api }, async () => {
  const calls = serve(limited(1), answer(200, { ok: true, id: 'L1' }));
  const started = Date.now();
  const saved = await api.mysqlAdmin.adminPost('/admin/leads', { name: 'هاله', phone: '01012345001' });
  assert.deepEqual(saved, { ok: true, id: 'L1' });
  assert.equal(calls.length, 2, 'the same POST went twice: the first never reached the route');
  assert.ok(Date.now() - started >= 900, 'and only after the wait the limiter asked for');
});

test('the 15-minute login lock is not waited out behind the person\'s back', { skip: !api }, async () => {
  const calls = serve(limited(900));
  await assert.rejects(api.mysqlAdmin.adminPost('/admin/leads', {}), /طلبات كثيرة/);
  assert.equal(calls.length, 1);
});

test('a 429 the limiter did not send, with no wait named, is not repeated', { skip: !api }, async () => {
  const calls = serve(answer(429, { error: 'Too Many Requests' }));
  await assert.rejects(api.mysqlAdmin.adminPost('/admin/leads', {}), /Too Many Requests/);
  assert.equal(calls.length, 1);
});
