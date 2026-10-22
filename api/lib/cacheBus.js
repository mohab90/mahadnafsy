'use strict';

// A cache dropped in one API process is dropped in the others.
//
// The settings, prices, catalogue and security lists are held in each
// process's memory for a minute to ten (lib/db.js cached, and the small caches
// in lib/whatsapp.js, lib/email.js, middleware/ipWhitelist.js…). Saving one
// dropped the copy in the process that took the save and no other: with the
// worker beside a MAHAD_ROLE=web API, or two web instances, the other kept
// serving the old price or the old IP list until its TTL ran out — and a
// revoked session token stayed good there until it expired.
//
// Each invalidation now also writes one row to cache_invalidations (migration
// 331); every process polls the rows after the last it saw, every
// CACHE_SYNC_MS (2s), and runs the same invalidation on its own copy. Cheap: one
// indexed read every two seconds, one insert per save. Started only when
// another process shares the database (lib/processRole.js sharesCaches); the
// single API keeps its caches exactly as before.
//
// An auto-increment id can become visible after a larger one (two inserts
// committing out of order), so each poll re-reads a short overlap behind the
// last id and skips the ids it already applied. Applying one twice only drops a
// cache twice.

const os = require('os');
const crypto = require('crypto');

const OVERLAP = 50;
const KEEP_MS = 60 * 60 * 1000;
const PRUNE_EVERY_MS = 10 * 60 * 1000;
const ORIGIN = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`.slice(0, 80);

function createCacheBus({
  db = () => require('./db').pool,
  origin = ORIGIN,
  logger = null,
  pollMs = Math.max(250, Number(process.env.CACHE_SYNC_MS) || 2000),
} = {}) {
  const handlers = new Map();
  const seen = new Set();
  let lastId = null;
  let timer = null;
  let started = false;
  let polling = false;
  let lastPrune = 0;
  let lastWarn = 0;

  // Resolved when first used: tests stand a bare logger in for lib/logger.js.
  const log = () => logger || require('./logger');
  const warn = (message, error) => {
    if (Date.now() - lastWarn < 60 * 1000) return;
    lastWarn = Date.now();
    log().warn(`[cache-bus] ${message}`, { error: error?.code || error?.message });
  };

  function on(channel, handler) {
    handlers.set(channel, handler);
  }

  /** Tell the other processes; a no-op until start() (the single API). */
  async function publish(channel, arg) {
    if (!started) return false;
    try {
      await db().query('INSERT INTO cache_invalidations (channel, arg, origin) VALUES (?, ?, ?)',
        [String(channel).slice(0, 64), arg == null ? null : String(arg).slice(0, 255), origin]);
      return true;
    } catch (error) {
      warn('cache invalidation not shared with the other processes', error);
      return false;
    }
  }

  function apply(row) {
    const handler = handlers.get(row.channel);
    if (!handler) return false;
    try {
      const outcome = handler(row.arg == null ? undefined : row.arg);
      if (outcome && typeof outcome.catch === 'function') outcome.catch(error => warn(`cache channel ${row.channel} failed`, error));
    } catch (error) {
      warn(`cache channel ${row.channel} failed`, error);
    }
    return true;
  }

  /** Apply what the other processes dropped since the last poll; returns how many. */
  async function pollOnce() {
    if (lastId === null) {
      // Starting now: this process's caches are empty, nothing earlier matters.
      const [[row]] = await db().query('SELECT COALESCE(MAX(id), 0) AS id FROM cache_invalidations');
      lastId = Number(row?.id) || 0;
      return 0;
    }
    const [rows] = await db().query(
      'SELECT id, channel, arg, origin FROM cache_invalidations WHERE id > ? ORDER BY id LIMIT 1000',
      [Math.max(0, lastId - OVERLAP)]);
    let applied = 0;
    for (const row of rows) {
      const id = Number(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      if (id > lastId) lastId = id;
      if (row.origin === origin) continue;
      if (apply(row)) applied += 1;
    }
    for (const id of seen) if (id <= lastId - OVERLAP) seen.delete(id);
    if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
      lastPrune = Date.now();
      await db().query('DELETE FROM cache_invalidations WHERE created_at < ? LIMIT 5000', [new Date(Date.now() - KEEP_MS)])
        .catch(error => warn('old cache invalidations not deleted', error));
    }
    return applied;
  }

  function start() {
    if (started) return false;
    started = true;
    const tick = async () => {
      if (polling) return;
      polling = true;
      try { await pollOnce(); } catch (error) { warn('cache invalidations not read', error); } finally { polling = false; }
    };
    tick();
    timer = setInterval(tick, pollMs);
    timer.unref?.();
    log().info(`[cache-bus] sharing cache invalidations with the other processes (every ${pollMs}ms)`);
    return true;
  }

  function stop() {
    started = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  /**
   * Wrap a local invalidation so it runs here at once and, through the table,
   * in every other process. Returns the wrapped function.
   */
  function shared(channel, local) {
    on(channel, local);
    return (arg, ...rest) => {
      const result = local(arg, ...rest);
      publish(channel, arg).catch(() => {});
      return result;
    };
  }

  return { on, publish, pollOnce, start, stop, shared, origin, isStarted: () => started };
}

const bus = createCacheBus();

/** server.js and worker.js: share invalidations when another process reads this database. */
function startCacheBus(env = process.env) {
  if (!require('./processRole').sharesCaches(env)) return false;
  return bus.start();
}

module.exports = { createCacheBus, bus, shared: bus.shared, startCacheBus, ORIGIN };
