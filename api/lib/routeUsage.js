'use strict';

// Which routes are used, counted per day and kept (table route_usage, migration 363).
//
// «مراقبة السيرفر» (lib/performanceMonitor.js) keeps per-endpoint figures in memory only, so every restart and every release empties them; the question «which of the
// thousand routes does nobody call?» needs weeks of calls across both API processes. A request adds one to a counter in memory; once a minute the counters are written
// with one INSERT … ON DUPLICATE KEY UPDATE (additive, so two processes share the table), and a day's row is the sum of what every process saw.
// Nothing here can fail a request: recording is a Map update and a failed flush keeps the counters for the next one.
// tools/route-usage-report.cjs lists the registered routes with no hit in N days — the only safe list to delete from.

const { cairoDayOf, cairoToday, addDaysToDateOnly } = require('./dates');

const FLUSH_MS = 60 * 1000;
const KEEP_DAYS = 400;
const MAX_KEYS = 5000;

// A day is the institute's day (Cairo), like every other figure of the panel.
function createRouteUsage({ now = () => new Date(), dayOf = date => cairoDayOf(date) } = {}) {
  const counters = new Map(); // `${day}\u0001${method}\u0001${route}` → { hits, errors }

  function record(method, route, status) {
    if (!route || !String(route).startsWith('/api/')) return;
    const key = `${dayOf(now())}\u0001${String(method).toUpperCase()}\u0001${route}`;
    let entry = counters.get(key);
    if (!entry) {
      if (counters.size >= MAX_KEYS) return; // a flood of distinct patterns is not routes
      entry = { hits: 0, errors: 0 };
      counters.set(key, entry);
    }
    entry.hits += 1;
    if (Number(status) >= 500) entry.errors += 1;
  }

  /** Takes the counters out; `restore` puts them back when the write failed. */
  function take() {
    const rows = [...counters].map(([key, entry]) => { const [day, method, route] = key.split('\u0001'); return { day, method, route, ...entry }; });
    counters.clear();
    return rows;
  }
  function restore(rows) {
    for (const row of rows) {
      const key = `${row.day}\u0001${row.method}\u0001${row.route}`;
      const entry = counters.get(key) || { hits: 0, errors: 0 };
      entry.hits += row.hits; entry.errors += row.errors;
      counters.set(key, entry);
    }
  }

  async function flush(db) {
    const rows = take();
    if (!rows.length) return 0;
    try {
      for (let i = 0; i < rows.length; i += 200) {
        const slice = rows.slice(i, i + 200);
        await db.query(
          `INSERT INTO route_usage (day, method, route, hits, errors, last_seen) VALUES ${slice.map(() => '(?,?,?,?,?,NOW())').join(',')}
           ON DUPLICATE KEY UPDATE hits = hits + VALUES(hits), errors = errors + VALUES(errors), last_seen = NOW()`,
          slice.flatMap(row => [row.day, row.method, row.route.slice(0, 190), row.hits, row.errors]));
      }
      return rows.length;
    } catch (error) {
      restore(rows);
      throw error;
    }
  }

  return { record, flush, size: () => counters.size, _take: take };
}

const usage = createRouteUsage();
let timer = null;

/** Starts the minute flush (production processes only; tests and tools never call it). */
function startRouteUsage({ pool, logger }) {
  if (timer) return;
  let purged = 0;
  timer = setInterval(async () => {
    try {
      await usage.flush(pool);
      if (Date.now() - purged > 24 * 3600 * 1000) {
        purged = Date.now();
        await pool.query('DELETE FROM route_usage WHERE day < ?', [addDaysToDateOnly(cairoToday(), -KEEP_DAYS)]);
      }
    } catch (error) { logger.warn('[route-usage] flush failed — kept for the next one:', error.message); }
  }, FLUSH_MS);
  timer.unref?.();
}

module.exports = { createRouteUsage, recordRouteUsage: usage.record, flushRouteUsage: db => usage.flush(db), startRouteUsage };
