'use strict';

// The lazy-chunk recovery in admin/index.tsx and client/index.tsx reloads the
// page when a code-split chunk fails to load after a deploy. A sessionStorage
// guard is what stops that reload from repeating forever.
//
// The guard was cleared at module scope, which runs on EVERY load — including
// the load the recovery itself triggered. location.replace keeps the same
// route, so the same lazy import ran again immediately, failed again, and found
// the guard already cleared. A chunk genuinely absent from the server reloaded
// in a tight loop.
//
// These tests drive the same state machine both files implement, so the shape
// of the bug is pinned down even though the source is TSX the API suite does
// not import.

const test = require('node:test');
const assert = require('node:assert');

const KEY = '_chunk_reload';

/** Minimal sessionStorage. */
const makeStorage = () => {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  };
};

/**
 * One page load, driven the way the browser drives it.
 *
 * `clearOnLoad` reproduces the old behaviour (clear the guard while the module
 * evaluates); the fix defers the clear past the point where a failing import
 * would be observed, which this models by not clearing during the load at all.
 */
function pageLoad(storage, { clearOnLoad, chunkLoads }) {
  if (clearOnLoad) storage.removeItem(KEY);
  if (chunkLoads) return { reloaded: false };
  if (storage.getItem(KEY)) return { reloaded: false }; // guard holds: show the error
  storage.setItem(KEY, '1');
  return { reloaded: true };
}

const run = (opts, maxLoads = 50) => {
  const storage = makeStorage();
  let reloads = 0;
  for (let i = 0; i < maxLoads; i += 1) {
    if (!pageLoad(storage, opts).reloaded) return { reloads, settled: true };
    reloads += 1;
  }
  return { reloads, settled: false };
};

test('a chunk missing from the server loops forever when the guard is cleared on every load', () => {
  const { settled } = run({ clearOnLoad: true, chunkLoads: false });
  assert.equal(settled, false, 'the old behaviour must be shown to run away');
});

test('a chunk missing from the server reloads once, then stops', () => {
  const { reloads, settled } = run({ clearOnLoad: false, chunkLoads: false });
  assert.equal(settled, true, 'recovery must settle instead of looping');
  assert.equal(reloads, 1, 'exactly one attempt, then the error is shown');
});

test('a stale chunk still gets its one recovery reload', () => {
  const storage = makeStorage();
  // Deploy happened: the open tab points at a chunk that no longer exists.
  assert.equal(pageLoad(storage, { clearOnLoad: false, chunkLoads: false }).reloaded, true);
  // The reload fetches the fresh document, so the chunk resolves.
  assert.equal(pageLoad(storage, { clearOnLoad: false, chunkLoads: true }).reloaded, false);
});

test('a later deploy in the same tab gets its own attempt once the guard is released', () => {
  const storage = makeStorage();
  assert.equal(pageLoad(storage, { clearOnLoad: false, chunkLoads: false }).reloaded, true);
  assert.equal(pageLoad(storage, { clearOnLoad: false, chunkLoads: true }).reloaded, false);
  // The app stayed up, so the deferred timer releases the guard.
  storage.removeItem(KEY);
  // Second deploy, same tab — this is what only ever worked once before.
  assert.equal(pageLoad(storage, { clearOnLoad: false, chunkLoads: false }).reloaded, true);
});
