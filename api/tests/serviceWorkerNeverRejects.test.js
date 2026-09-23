'use strict';
// The service worker answers respondWith() for every request it intercepts, and
// a promise that rejects there does not fall back to the network — the browser
// turns it into a failed navigation. A customer's console on 2026-09-23, minutes
// after a release:
//
//   The FetchEvent for "https://mahadnafsy.com/c/positive-parenting" resulted in
//   a network error response: the promise was rejected.
//   sw.js:55  Uncaught (in promise) TypeError: Failed to fetch
//
// The asset branch called fetch() with no .catch(), so any momentary failure —
// most likely in the seconds during a deploy when files are being swapped —
// took the whole page down instead of failing one request.
//
// These drive the real file in a stubbed worker scope, so they check what it
// does rather than what it looks like.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'client', 'public', 'sw.js'), 'utf8');

const ORIGIN = 'https://mahadnafsy.com';
const keyOf = (req) => (typeof req === 'string' ? req : new URL(req.url).pathname);

function loadWorker({ fetchImpl, cached = {}, addFails = [] } = {}) {
  const handlers = {};
  const store = new Map(Object.entries(cached));
  const added = [];

  const cache = {
    put: async (req, res) => { store.set(keyOf(req), res); },
    add: async (asset) => {
      if (addFails.includes(asset)) throw new Error(`404 ${asset}`);
      added.push(asset);
    },
    match: async (req) => store.get(keyOf(req)),
  };
  const caches = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
    match: async (req) => store.get(keyOf(req)),
  };
  const self = {
    addEventListener: (name, fn) => { handlers[name] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => {} },
    location: { origin: ORIGIN },
  };

  vm.runInNewContext(SOURCE, { self, caches, fetch: fetchImpl, Response, URL, console });
  return { handlers, added, store };
}

/** Fire a fetch event and return whatever the worker answered with. */
function respond(handlers, request) {
  let answered;
  handlers.fetch({ request, respondWith: (p) => { answered = p; } });
  return answered;
}

const asset = { method: 'GET', url: `${ORIGIN}/assets/index-abc123.js`, mode: 'cors' };
const page = { method: 'GET', url: `${ORIGIN}/c/positive-parenting`, mode: 'navigate' };
const failing = async () => { throw new TypeError('Failed to fetch'); };

test('an asset whose fetch fails answers instead of rejecting', async () => {
  const { handlers } = loadWorker({ fetchImpl: failing });
  const answered = respond(handlers, asset);
  assert.ok(answered, 'the worker must answer a request it intercepted');
  // The assertion that matters: awaiting this must not throw. A rejection here
  // is what the browser reports as "the promise was rejected".
  const response = await answered;
  assert.ok(response, 'an answer, not undefined — respondWith(undefined) is itself a network error');
});

test('a failed asset falls back to its cached copy when there is one', async () => {
  const stale = new Response('console.log(1)', { status: 200 });
  const { handlers } = loadWorker({ fetchImpl: failing, cached: { '/assets/index-abc123.js': stale } });
  const response = await respond(handlers, asset);
  assert.equal(response, stale, 'a cached copy beats a network error');
});

test('an offline navigation falls back to the cached shell', async () => {
  const shell = new Response('<!doctype html>shell', { status: 200 });
  const { handlers } = loadWorker({ fetchImpl: failing, cached: { '/index.html': shell } });
  const response = await respond(handlers, page);
  assert.equal(response, shell);
});

test('an offline navigation with nothing cached still answers', async () => {
  // caches.match resolves undefined on a miss, and respondWith(undefined) is a
  // network error — the blank page the fallback exists to prevent.
  const { handlers } = loadWorker({ fetchImpl: failing });
  const response = await respond(handlers, page);
  assert.ok(response, 'undefined would be a blank page');
  assert.equal(response.status, 503);
});

test('one missing pre-cached file does not stop the worker installing', async () => {
  // addAll is atomic. When it was used, a single renamed icon failed the whole
  // install, the new worker never activated, and returning visitors kept being
  // served the previous release's JS.
  const { handlers, added } = loadWorker({
    fetchImpl: failing,
    addFails: ['/manifest.json'],
  });
  let waited;
  handlers.install({ waitUntil: (p) => { waited = p; } });
  await waited; // must not reject
  assert.ok(added.includes('/index.html'), 'the files that do exist are still cached');
  assert.ok(!added.includes('/manifest.json'));
});

test('the cache name carries the build, so a release replaces the old one', () => {
  // Left as the literal placeholder, every release shares one cache name and
  // activate() deletes nothing, so cache-first serves the old JS for ever.
  assert.match(SOURCE, /const CACHE_NAME = 'mahad-__SW_VERSION__'/,
    'the source keeps the placeholder; the build is what substitutes it');
  const built = fs.existsSync(path.join(__dirname, '..', '..', 'client', 'dist', 'sw.js'))
    ? fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'dist', 'sw.js'), 'utf8')
    : null;
  if (built) {
    assert.doesNotMatch(built, /__SW_VERSION__/,
      'the built worker must have a real version, or no release ever evicts the last one');
  }
});
