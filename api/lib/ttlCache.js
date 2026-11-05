'use strict';

// A small in-memory cache for the figures the panel asks for again and again: a held answer for `ttlMs`, one computation shared by everybody who asks while it
// runs (a dozen screens opening together ask the database once), and — for the keys that opt in with `staleMs` — the OLD answer handed back at once when the
// entry has just expired while a new one is computed in the background, so nobody waits for the 2–5 s a big aggregate takes more than once per window.
//
// Staleness is bounded by ttlMs + staleMs and only ever concerns an entry nothing wrote through (a write in this process drops its keys: lib/httpApp.js
// dropFiguresAfterWrites → invalidate). A refresh that fails keeps the old answer and the next ask tries again; it never turns a held answer into an error.

function createTtlCache({ max = 500, now = Date.now } = {}) {
  const entries = new Map();
  const pending = new Map();

  function start(key, compute) {
    const promise = Promise.resolve().then(compute).then(data => {
      if (pending.get(key) === promise) { // not dropped by an invalidation meanwhile
        if (entries.size >= max) entries.delete(entries.keys().next().value);
        entries.set(key, { data, ts: now() });
      }
      return data;
    }).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
    pending.set(key, promise);
    return promise;
  }

  /** `staleMs` > 0: an entry up to ttlMs + staleMs old is returned at once and refreshed behind. */
  function cached(key, ttlMs, compute, { staleMs = 0 } = {}) {
    const hit = entries.get(key);
    const age = hit ? now() - hit.ts : Infinity;
    if (hit && age < ttlMs) return Promise.resolve(hit.data);
    const running = pending.get(key);
    if (hit && staleMs > 0 && age < ttlMs + staleMs) {
      if (!running) start(key, compute).catch(() => { /* the old answer stays; the next ask tries again */ });
      return Promise.resolve(hit.data);
    }
    return running || start(key, compute);
  }

  /** No prefixes: everything. */
  function invalidate(...prefixes) {
    if (prefixes.length === 0) { entries.clear(); pending.clear(); return; }
    for (const key of [...entries.keys()]) if (prefixes.some(prefix => key.startsWith(prefix))) entries.delete(key);
    for (const key of [...pending.keys()]) if (prefixes.some(prefix => key.startsWith(prefix))) pending.delete(key);
  }

  return { cached, invalidate, size: () => entries.size };
}

module.exports = { createTtlCache };
