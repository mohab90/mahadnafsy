'use strict';
/**
 * Where the time goes — per endpoint and per query — kept in memory and read from
 * «مراقبة السيرفر».
 *
 * «السيستم بطيء جدا … عاوز علاج نهائي» (17 Oct 2026). The access log says how long a request
 * took; it does not say whether the time was the database, how many queries it made, how much it
 * sent, or which query was the slow one — so a slow screen could only be guessed at. This keeps
 * that, for the last stretch of traffic, and says so out loud in the log when a request or a
 * query is slow.
 *
 * Everything here is bounded: a ring of recent durations per route (capped number of routes) and a
 * capped table of query shapes. A failure here never reaches a request.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS) || 1500;
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS) || 400;
const MANY_QUERIES = Number(process.env.MANY_QUERIES_PER_REQUEST) || 25;
const RING = 200;
const MAX_ROUTES = 400;
const MAX_QUERY_SHAPES = 300;
// One log line per route or query shape per this long: a slow screen is a line, not a storm.
const LOG_EVERY_MS = 10_000;

const routes = new Map();
const shapes = new Map();
const startedAt = Date.now();

/**
 * Runs `fn(store)` with a request's own counters in scope: queries made while it runs add to them.
 * The store is handed to `fn` because an event listener (the response's 'finish') does not run in the
 * context it was registered in.
 */
function runInRequest(fn) {
  const store = { queries: 0, dbMs: 0, slowest: null };
  return als.run(store, () => fn(store));
}

/** `SELECT … WHERE id = 'x'` and the same with another id are one shape. */
function shapeOf(sql) {
  return String(sql || '')
    .replace(/\s+/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, '?')
    .replace(/\b\d+(\.\d+)?\b/g, '?')
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, '(?…)')
    .trim()
    .slice(0, 200);
}

/** Called by the database layer around every pooled query. */
function recordQuery(sql, ms) {
  try {
    const store = als.getStore();
    if (store) {
      store.queries += 1;
      store.dbMs += ms;
      if (!store.slowest || ms > store.slowest.ms) store.slowest = { ms, shape: shapeOf(sql) };
    }
    if (ms < SLOW_QUERY_MS) return;
    const shape = shapeOf(sql);
    let entry = shapes.get(shape);
    if (!entry) {
      if (shapes.size >= MAX_QUERY_SHAPES) shapes.delete(shapes.keys().next().value);
      entry = { shape, count: 0, totalMs: 0, maxMs: 0, last: 0, logged: 0 };
      shapes.set(shape, entry);
    }
    entry.count += 1; entry.totalMs += ms; entry.maxMs = Math.max(entry.maxMs, ms); entry.last = Date.now();
    if (Date.now() - entry.logged >= LOG_EVERY_MS) {
      entry.logged = Date.now();
      require('./logger').warn('slow query', { ms: Math.round(ms), statement: shape });
    }
  } catch { /* monitoring never breaks a query */ }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** Called when a request finishes. `route` is the matched pattern (`/api/admin/join-us/:id`), not the URL. */
function recordRequest({ method, route, status, ms, bytes, store: given }) {
  try {
    const store = given || als.getStore() || { queries: 0, dbMs: 0, slowest: null };
    const key = `${method} ${route}`;
    let entry = routes.get(key);
    if (!entry) {
      if (routes.size >= MAX_ROUTES) routes.delete(routes.keys().next().value);
      entry = { key, count: 0, errors: 0, ring: [], bytes: 0, queries: 0, dbMs: 0, maxMs: 0, maxQueries: 0, last: 0, logged: 0 };
      routes.set(key, entry);
    }
    entry.count += 1;
    if (status >= 500) entry.errors += 1;
    entry.ring.push(ms); if (entry.ring.length > RING) entry.ring.shift();
    entry.bytes += bytes || 0; entry.queries += store.queries; entry.dbMs += store.dbMs;
    entry.maxMs = Math.max(entry.maxMs, ms); entry.maxQueries = Math.max(entry.maxQueries, store.queries);
    entry.last = Date.now();
    // The watchdog reads the last hour of this traffic (lib/opsWatchdog.js).
    require('./opsWatchdog').noteRequest({ route: key, status, ms });
    if ((ms >= SLOW_REQUEST_MS || store.queries >= MANY_QUERIES) && Date.now() - entry.logged >= LOG_EVERY_MS) {
      entry.logged = Date.now();
      require('./logger').warn('slow request', {
        route: key, ms: Math.round(ms), dbMs: Math.round(store.dbMs), queries: store.queries,
        bytes: bytes || 0, slowestQuery: store.slowest ? `${Math.round(store.slowest.ms)}ms ${store.slowest.shape}` : undefined,
      });
    }
  } catch { /* monitoring never breaks a request */ }
}

/** The slowest endpoints by their 95th percentile, and the slow query shapes. */
function snapshot({ limit = 25 } = {}) {
  const endpoints = [...routes.values()].map(entry => {
    const sorted = [...entry.ring].sort((a, b) => a - b);
    return {
      route: entry.key,
      count: entry.count,
      errors: entry.errors,
      p50: Math.round(percentile(sorted, 0.5)),
      p95: Math.round(percentile(sorted, 0.95)),
      max: Math.round(entry.maxMs),
      avgKb: Math.round(entry.bytes / entry.count / 102.4) / 10,
      avgQueries: Math.round(entry.queries / entry.count * 10) / 10,
      maxQueries: entry.maxQueries,
      avgDbMs: Math.round(entry.dbMs / entry.count),
      lastAt: new Date(entry.last).toISOString(),
    };
  });
  const slowest = [...endpoints].sort((a, b) => b.p95 - a.p95).slice(0, limit);
  const heaviest = [...endpoints].sort((a, b) => b.avgKb - a.avgKb).slice(0, 10);
  const chattiest = [...endpoints].sort((a, b) => b.avgQueries - a.avgQueries).slice(0, 10);
  const slowQueries = [...shapes.values()]
    .map(entry => ({ shape: entry.shape, count: entry.count, avgMs: Math.round(entry.totalMs / entry.count), maxMs: Math.round(entry.maxMs), lastAt: new Date(entry.last).toISOString() }))
    .sort((a, b) => b.maxMs - a.maxMs).slice(0, limit);
  return {
    since: new Date(startedAt).toISOString(),
    thresholds: { slowRequestMs: SLOW_REQUEST_MS, slowQueryMs: SLOW_QUERY_MS, manyQueries: MANY_QUERIES },
    requests: endpoints.reduce((sum, entry) => sum + entry.count, 0),
    slowest, heaviest, chattiest, slowQueries,
  };
}

function reset() { routes.clear(); shapes.clear(); }

module.exports = { runInRequest, recordQuery, recordRequest, snapshot, shapeOf, reset, SLOW_REQUEST_MS, SLOW_QUERY_MS };
