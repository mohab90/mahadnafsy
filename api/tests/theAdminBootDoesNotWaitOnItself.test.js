'use strict';

// «شوف ايه اللى يخفف السيستم ويسرع السيرفر» — and the answer turned out not to
// be on the server at all.
//
// The server was measured first, because guessing at performance is how you end
// up tuning the thing that was already fast: the API answers in 3–15ms, the
// home page's first byte in 28ms, the InnoDB buffer pool hits 99.994%, the
// whole API burned 32 minutes of CPU in eleven days, and the two heaviest
// queries the admin boot makes come back in 18ms and 9ms. There is nothing
// there to speed up.
//
// The admin boot, meanwhile, slept. Five waves of requests with
// `await new Promise(resolve => setTimeout(resolve, 300))` between them — 1.2
// seconds of doing nothing, on every load, for every member of staff, on top of
// the requests themselves. No comment gave a reason and none of the usual ones
// hold: the privileged rate limit is 400 requests a minute and the boot makes
// 21, and HTTP/2 multiplexes them down one connection. They arrived inside a
// bulk "platform expansion" commit rather than as a fix for anything.
//
// The waves stay. Landing the first one and painting before the rest of the
// work starts is the right shape, and it is why this file pins the structure as
// well as the absence of the sleeps — someone removing the staging to "make it
// one request" would be trading a fast first paint for a slower one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = 'admin/context/site-data-hooks/useAdminDataRuntime.ts';
const source = fs.readFileSync(path.join(ROOT, RUNTIME), 'utf8');

test('the boot never sleeps between its waves', () => {
  const sleeps = source.match(/await new Promise\(\s*resolve\s*=>\s*setTimeout\(resolve,\s*\d+\s*\)\s*\)/g) || [];
  assert.deepEqual(sleeps, [],
    'each one of these is dead time on every admin page load, and the server it was pacing is idle');
});

test('a retry backoff is still allowed to wait', () => {
  // The distinction that matters: waiting because a request failed is a reason;
  // waiting because the next request has not been made yet is not.
  const api = fs.readFileSync(path.join(ROOT, 'admin/lib/mysqlapi.ts'), 'utf8');
  assert.match(api, /setTimeout\(r, RETRY_BACKOFF_MS\)/,
    'the retry path is not what this rule is about');
});

test('the waves themselves are kept', () => {
  // Five batches, each awaited, so the screen paints on the first one instead
  // of waiting for all twenty-one calls to land.
  const waves = source.match(/await Promise\.allSettled\(\[/g) || [];
  assert.ok(waves.length >= 5,
    'the boot is staged on purpose — the first wave is what the dashboard draws from');
});
