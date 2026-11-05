'use strict';

// lib/ttlCache.js: the held answer, one computation for everybody who asks together, the old answer at once (with a refresh behind) for the keys that opt in,
// and nothing stale after a write drops the key.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTtlCache } = require('../lib/ttlCache');

function clockedCache() {
  let t = 1000;
  const cache = createTtlCache({ max: 3, now: () => t });
  return { cache, advance: ms => { t += ms; } };
}
const later = ms => new Promise(resolve => setTimeout(resolve, ms));

test('an answer is held for the ttl and computed again after it', async () => {
  const { cache, advance } = clockedCache();
  let runs = 0;
  const compute = async () => ++runs;
  assert.equal(await cache.cached('a', 1000, compute), 1);
  assert.equal(await cache.cached('a', 1000, compute), 1, 'held');
  advance(1001);
  assert.equal(await cache.cached('a', 1000, compute), 2, 'expired: computed again, and waited for');
});

test('everybody who asks while it is computed shares one computation', async () => {
  const { cache } = clockedCache();
  let runs = 0;
  const compute = async () => { runs += 1; await later(20); return 'x'; };
  const answers = await Promise.all([cache.cached('k', 1000, compute), cache.cached('k', 1000, compute), cache.cached('k', 1000, compute)]);
  assert.deepEqual(answers, ['x', 'x', 'x']);
  assert.equal(runs, 1);
});

test('a key that opts in gets the old answer at once and a refresh behind, within the stale window only', async () => {
  const { cache, advance } = clockedCache();
  let runs = 0;
  const compute = async () => { runs += 1; await later(15); return `v${runs}`; };
  const options = { staleMs: 2000 };
  assert.equal(await cache.cached('s', 1000, compute, options), 'v1');
  advance(1500);                                                   // expired, inside the stale window
  assert.equal(await cache.cached('s', 1000, compute, options), 'v1', 'the old answer, immediately');
  assert.equal(await cache.cached('s', 1000, compute, options), 'v1', 'still the old one while the refresh runs, and no second refresh starts');
  await later(40);
  assert.equal(runs, 2, 'one refresh');
  assert.equal(await cache.cached('s', 1000, compute, options), 'v2', 'the refreshed answer');
  advance(5000);                                                   // past the stale window: nobody gets the old one
  assert.equal(await cache.cached('s', 1000, compute, options), 'v3', 'waited for');
});

test('without staleMs an expired entry is never returned', async () => {
  const { cache, advance } = clockedCache();
  let runs = 0;
  await cache.cached('n', 1000, async () => ++runs);
  advance(1500);
  assert.equal(await cache.cached('n', 1000, async () => ++runs), 2);
});

test('a failed refresh keeps the old answer, and the next ask tries again', async () => {
  const { cache, advance } = clockedCache();
  let fail = false;
  let runs = 0;
  const compute = async () => { runs += 1; if (fail) throw new Error('db down'); return `v${runs}`; };
  assert.equal(await cache.cached('f', 1000, compute, { staleMs: 5000 }), 'v1');
  fail = true;
  advance(1500);
  assert.equal(await cache.cached('f', 1000, compute, { staleMs: 5000 }), 'v1');
  await later(10);
  fail = false;
  assert.equal(await cache.cached('f', 1000, compute, { staleMs: 5000 }), 'v1', 'the failed refresh did not replace it');
  await later(10);
  assert.equal(await cache.cached('f', 1000, compute, { staleMs: 5000 }), 'v3', 'the next ask refreshed it');
});

test('a write drops the key: no stale answer after it, and a refresh that began before it is not stored', async () => {
  const { cache, advance } = clockedCache();
  let value = 'before';
  const compute = async () => { const seen = value; await later(20); return seen; };
  await cache.cached('figures:x', 1000, compute, { staleMs: 5000 });
  advance(1500);
  assert.equal(await cache.cached('figures:x', 1000, compute, { staleMs: 5000 }), 'before');   // refresh starts, reading 'before'
  value = 'after';
  cache.invalidate('figures:');                                                                    // the write
  await later(40);
  assert.equal(await cache.cached('figures:x', 1000, async () => value), 'after', 'the refresh that began before the write was not kept');
});

test('invalidate by prefix leaves the others, and the cache is bounded', async () => {
  const { cache } = clockedCache();
  await cache.cached('figures:a', 1000, async () => 1);
  await cache.cached('catalog:b', 1000, async () => 2);
  cache.invalidate('figures:');
  let runs = 0;
  await cache.cached('figures:a', 1000, async () => ++runs);
  await cache.cached('catalog:b', 1000, async () => ++runs);
  assert.equal(runs, 1, 'only figures: was dropped');
  await cache.cached('c', 1000, async () => 3);
  await cache.cached('d', 1000, async () => 4);
  assert.ok(cache.size() <= 3, 'bounded by max');
});
