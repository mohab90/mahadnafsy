'use strict';

// An express-rate-limit store every API process shares, in the database they
// already share (migration 330). With two web instances behind nginx each one
// counted in its own memory, so every limit was doubled: thirty login guesses
// where fifteen were meant, ten OTP tries where five were. Redis does this
// better (lib/rateLimitStore.js, RATE_LIMIT_REDIS_ENABLED) but the server has
// none; this needs nothing new.
//
// Fixed windows aligned to the clock: one row per limiter + key + window, and
// one statement per request — an upsert that adds one and returns the new count
// through LAST_INSERT_ID, so two processes counting the same key at the same
// instant still get 1 and 2, never 1 and 1. The reset time is the window's end,
// known without reading. The price is that a burst straddling two windows can
// reach twice the limit for a moment, as with any fixed window.
//
// If the database cannot be asked, the request is counted in this process's
// memory instead of failing: per-process limits for as long as that lasts,
// which is what a single instance has always had.

const crypto = require('crypto');
const { MemoryStore } = require('express-rate-limit');
const logger = require('./logger').child({ module: 'rate-limit-mysql' });

const SWEEP_MS = 5 * 60 * 1000;
let sweepTimer = null;
let lastWarn = 0;

const defaultDb = () => require('./db').pool;

function warn(message, error) {
  // Once a minute at most: a database outage would otherwise log every request.
  if (Date.now() - lastWarn < 60 * 1000) return;
  lastWarn = Date.now();
  logger.warn(message, { error: error?.code || error?.message });
}

/** Expired windows go; any process may do it, and repeating it is harmless. */
async function sweepExpired(db = defaultDb(), now = Date.now()) {
  const [result] = await db.query('DELETE FROM rate_limit_counters WHERE expires_at < ? LIMIT 5000', [new Date(now - 60 * 1000)]);
  return result?.affectedRows || 0;
}

function startSweep(db) {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => { sweepExpired(db()).catch(error => warn('expired rate-limit windows not deleted', error)); }, SWEEP_MS);
  sweepTimer.unref?.();
}

class MysqlRateLimitStore {
  constructor(name, { db = defaultDb, now = Date.now } = {}) {
    this.prefix = `mahad:rate:${name}:`;
    // Counts reach every process: express-rate-limit's double-count check reads this.
    this.localKeys = false;
    this.db = db;
    this.now = now;
    this.windowMs = 60 * 1000;
    this.fallback = new MemoryStore();
  }

  init(options) {
    this.windowMs = Math.max(1000, Number(options?.windowMs) || this.windowMs);
    this.fallback.init(options);
    startSweep(this.db);
  }

  bucket(key, at = this.now()) {
    const window = Math.floor(at / this.windowMs);
    const hash = crypto.createHash('sha256').update(`${this.prefix}${key}:${this.windowMs}:${window}`).digest('hex');
    return { hash, resetTime: new Date((window + 1) * this.windowMs) };
  }

  async increment(key) {
    const { hash, resetTime } = this.bucket(key);
    try {
      const [result] = await this.db().query(
        `INSERT INTO rate_limit_counters (bucket, hits, expires_at) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE hits = LAST_INSERT_ID(hits + 1)`,
        [hash, resetTime]);
      // 1 row affected: inserted, the first hit. 2: updated, and insertId
      // carries the count LAST_INSERT_ID was given.
      const totalHits = Number(result?.affectedRows) === 1 ? 1 : Number(result?.insertId) || 1;
      return { totalHits, resetTime };
    } catch (error) {
      warn('shared rate-limit store unavailable — counting in this process', error);
      return this.fallback.increment(key);
    }
  }

  async decrement(key) {
    const { hash } = this.bucket(key);
    try {
      await this.db().query('UPDATE rate_limit_counters SET hits = GREATEST(hits, 1) - 1 WHERE bucket=?', [hash]);
    } catch (error) {
      warn('shared rate-limit decrement failed', error);
      await this.fallback.decrement(key);
    }
  }

  async resetKey(key) {
    const { hash } = this.bucket(key);
    await this.fallback.resetKey(key);
    await this.db().query('DELETE FROM rate_limit_counters WHERE bucket=?', [hash]).catch(error => warn('shared rate-limit reset failed', error));
  }

  async get(key) {
    const { hash, resetTime } = this.bucket(key);
    try {
      const [[row]] = await this.db().query('SELECT hits FROM rate_limit_counters WHERE bucket=?', [hash]);
      return row ? { totalHits: Number(row.hits), resetTime } : undefined;
    } catch (error) {
      warn('shared rate-limit read failed', error);
      return this.fallback.get(key);
    }
  }

  shutdown() {
    this.fallback.shutdown?.();
  }
}

module.exports = { MysqlRateLimitStore, sweepExpired };
