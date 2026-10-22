'use strict';
// ── MySQL Connection Pool + DB helpers ────────────────────────────────────────
// Requires dotenv to be loaded BEFORE this module is required.
const mysql  = require('mysql2/promise');
const logger = require('./logger');
const { getDbSslConfig } = require('./dbSsl');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || '127.0.0.1',
  port:    parseInt(  process.env.DB_PORT     || '3306'),
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME,
  ssl:                getDbSslConfig(),
  waitForConnections: true,
  // Default sized for the dedicated VPS target (100 concurrent staff). MySQL's
  // default max_connections (151) comfortably absorbs this with headroom for
  // other clients; drop DB_POOL_LIMIT back to ~10 in env on constrained/shared
  // hosting, or raise it further on a bigger box.
  connectionLimit:    parseInt(process.env.DB_POOL_LIMIT  || '20'),
  queueLimit:         parseInt(process.env.DB_QUEUE_LIMIT || '200'),
  connectTimeout:     parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '3000'),
  charset:            'UTF8MB4_UNICODE_CI',
  // MySQL DATE has no time zone. Returning it as a JavaScript Date shifts Cairo
  // midnight to the previous UTC day and corrupts due dates/period boundaries.
  dateStrings:        ['DATE'],
  // Every DATETIME the API writes with NOW() is a UTC wall clock, and every
  // reader (lib/dates.js, shared/cairoDate.ts) takes a zoneless value as UTC.
  // 'local' — the default — meant "whatever zone the host is set to": on a VPS
  // set to Africa/Cairo a Date bound as a parameter was written three hours
  // ahead of the rows NOW() wrote beside it.
  timezone:           'Z',
  enableKeepAlive:    true,
  keepAliveInitialDelay: 10000,
});

// Force utf8mb4_unicode_ci collation on every new connection (fixes MariaDB default uca1400)
pool.on('connection', (conn) => {
  conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci", (err) => {
    if (err) logger.warn('[pool] SET NAMES error:', err.message);
  });
  // The session's clock, for the same reason as `timezone: 'Z'` above: NOW(),
  // CURRENT_TIMESTAMP defaults and TIMESTAMP columns follow the session zone,
  // which is the server's own unless set. A numeric offset needs no time-zone
  // tables, which this database does not have.
  conn.query("SET time_zone = '+00:00'", (err) => {
    if (err) logger.warn('[pool] SET time_zone error:', err.message);
  });
});

/**
 * What the three clocks say, for the boot log and «مراقبة السيرفر».
 *
 * The pool pins its own sessions to UTC, so this asks about what it cannot pin:
 * the process zone (Date's local getters) and the database server's own zone,
 * which is what any other client — a cron, a manual import, a session opened
 * before this release — wrote NOW() in. A non-UTC global zone does not break
 * the API, but rows written that way hold Cairo wall time and read three (or
 * two) hours late; that is worth a look, not a migration.
 */
async function clockContract(db = pool) {
  const processOffsetMinutes = -new Date().getTimezoneOffset();
  const out = {
    processTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || '',
    processOffsetMinutes,
    dbSessionTimeZone: null, dbGlobalTimeZone: null, dbSystemTimeZone: null, dbSkewSeconds: null,
  };
  try {
    const [[row]] = await db.query(
      `SELECT @@session.time_zone AS s, @@global.time_zone AS g, @@system_time_zone AS sys,
              TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS skew`);
    out.dbSessionTimeZone = row.s;
    out.dbGlobalTimeZone = row.g;
    out.dbSystemTimeZone = row.sys;
    out.dbSkewSeconds = Number(row.skew);
  } catch (_) { /* reported as unknown */ }
  const utcName = zone => /^(UTC|Etc\/UTC|Etc\/GMT|GMT|Z|\+00:00|Coordinated Universal Time)$/i.test(String(zone || ''));
  out.dbServerIsUtc = out.dbGlobalTimeZone === null ? null
    : utcName(out.dbGlobalTimeZone) || (String(out.dbGlobalTimeZone).toUpperCase() === 'SYSTEM' && utcName(out.dbSystemTimeZone));
  out.ok = processOffsetMinutes === 0 && out.dbSkewSeconds === 0;
  return out;
}

// ── DB state tracker — fast-fail while the database endpoint is down ──────────
// ECONNREFUSED = endpoint unavailable — no point retrying immediately.
// Other errors (ECONNRESET, ETIMEDOUT) = stale/dropped connections — worth one retry
let _dbDown = false;
let _dbDownAt = 0;
const DB_RECHECK_INTERVAL = 5000; // re-probe after 5s of being down

function _markDbDown() { _dbDown = true; _dbDownAt = Date.now(); }
function _markDbUp()   { _dbDown = false; }
function isDbDown()    { return _dbDown && (Date.now() - _dbDownAt < DB_RECHECK_INTERVAL); }

pool.on('error', (err) => {
  logger.error('[Pool] Connection error (will auto-recover):', err.message, err.code);
  _markDbDown();
});

// Middleware: respond 503 immediately instead of hanging when DB is known down
function requireDb(req, res, next) {
  if (isDbDown()) {
    try {
      require('./errorMonitor').recordError({
        statusCode: 503,
        kind: 'db_unavailable',
        method: req.method,
        path: req.path,
      });
    } catch (_) {}
    return res.status(503).json({ error: 'Database unavailable', db: 'disconnected' });
  }
  next();
}

// ── DB Query Helper with auto-retry on stale-connection errors ────────────────
// ECONNREFUSED excluded: the endpoint is unavailable, so retrying immediately will not help.
const RETRYABLE = new Set(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'ER_SERVER_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR']);
// How long each pooled query took, per request and per query shape (lib/performanceMonitor.js).
const perfMonitor = require('./performanceMonitor');
const _origQuery   = pool.query.bind(pool);
const _origExecute = pool.execute.bind(pool);

function _firstSqlArg(args) {
  const first = args && args[0];
  if (typeof first === 'string') return first;
  if (first && typeof first.sql === 'string') return first.sql;
  return '';
}

function _isSchemaDdl(sql) {
  return /^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME)\s+/i.test(String(sql || ''));
}

// Only a read is sent again after a lost connection. A write may have reached
// the server before the answer was lost, and a second one books it twice — an
// `uses = uses + 1`, an insert under a fresh id.
function _isRead(sql) {
  return /^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN)\b/i.test(String(sql || ''));
}

function _schemaDdlAllowed() {
  return process.env.MAHAD_SCHEMA_MIGRATION_ACTIVE === '1';
}

function _skipSchemaDdl(sql) {
  logger.warn('[schema] runtime DDL blocked; use numbered migrations', {
    statement: String(sql || '').replace(/\s+/g, ' ').trim().slice(0, 180),
  });
  try {
    require('./errorMonitor').recordError({
      statusCode: 0,
      kind: 'runtime_schema_ddl_blocked',
    });
  } catch (_) {}
  return [{ affectedRows: 0, changedRows: 0, warningStatus: 0, schemaDdlSkipped: true }, undefined];
}

pool.query = async (...args) => {
  const sql = _firstSqlArg(args);
  if (_isSchemaDdl(sql) && !_schemaDdlAllowed()) return _skipSchemaDdl(sql);
  const began = Date.now();
  try {
    const result = await _origQuery(...args);
    _markDbUp();
    perfMonitor.recordQuery(sql, Date.now() - began);
    return result;
  } catch (err) {
    if (RETRYABLE.has(err.code) && _isRead(sql)) { logger.warn('[DB] Stale connection, retrying…', err.code); return await _origQuery(...args); }
    if (err.code === 'ECONNREFUSED') _markDbDown();
    throw err;
  }
};
pool.execute = async (...args) => {
  const sql = _firstSqlArg(args);
  if (_isSchemaDdl(sql) && !_schemaDdlAllowed()) return _skipSchemaDdl(sql);
  const began = Date.now();
  try {
    const result = await _origExecute(...args);
    _markDbUp();
    perfMonitor.recordQuery(sql, Date.now() - began);
    return result;
  } catch (err) {
    if (RETRYABLE.has(err.code) && _isRead(sql)) { logger.warn('[DB] Stale connection, retrying…', err.code); return await _origExecute(...args); }
    if (err.code === 'ECONNREFUSED') _markDbDown();
    throw err;
  }
};
async function dbQuery(sql, params)   { return pool.query(sql, params); }
async function dbExecute(sql, params) { return pool.execute(sql, params); }

// ── In-memory Cache ───────────────────────────────────────────────────────────
// Lightweight TTL cache with LRU eviction — avoids hammering DB for public endpoints.
// Max 500 entries; when full, the oldest-inserted key is evicted before adding new ones.
const CACHE_MAX = 500;
const _cache = new Map();
const _pendingCache = new Map();
function cached(key, ttlMs, fn) {
  // In development, keep the catalog cache very short so admin edits (new courses,
  // price changes, etc.) appear almost immediately instead of after the full TTL.
  if (process.env.NODE_ENV !== 'production') ttlMs = Math.min(ttlMs, 3000);
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  const pending = _pendingCache.get(key);
  if (pending) return pending;
  const promise = Promise.resolve().then(fn).then(data => {
    if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
    _cache.set(key, { data, ts: Date.now() });
    return data;
  }).finally(() => _pendingCache.delete(key));
  _pendingCache.set(key, promise);
  return promise;
}
// This process only. «figures:» (lib/httpApp.js) is dropped on every write and
// lives fifteen seconds; sharing it would be one insert per request for nothing.
function cacheInvalidateLocal(...prefixes) {
  if (prefixes.length === 0) { _cache.clear(); _pendingCache.clear(); return; }
  for (const k of _cache.keys()) {
    if (prefixes.some(p => k.startsWith(p))) _cache.delete(k);
  }
  for (const k of _pendingCache.keys()) {
    if (prefixes.some(p => k.startsWith(p))) _pendingCache.delete(k);
  }
}

// A catalogue, price, branch or site-content save drops these in every API
// process (lib/cacheBus.js), not only the one that took it. No prefixes: all.
const cacheBus = require('./cacheBus');
cacheBus.bus.on('db-cache', arg => {
  let prefixes = [];
  try { prefixes = arg ? JSON.parse(arg) : []; } catch (_) { prefixes = []; }
  cacheInvalidateLocal(...(Array.isArray(prefixes) ? prefixes.map(String) : []));
});
function cacheInvalidate(...prefixes) {
  cacheInvalidateLocal(...prefixes);
  cacheBus.bus.publish('db-cache', prefixes.length ? JSON.stringify(prefixes) : null).catch(() => {});
}

// ── Concurrency guard ─────────────────────────────────────────────────────────
// Tunable per environment — should track connectionLimit above, not sit fixed
// below it (a lower hardcoded value throttles requests even when the pool has
// spare connections).
const DB_MAX_CONCURRENT = parseInt(process.env.DB_MAX_CONCURRENT || process.env.DB_POOL_LIMIT || '20');
let _dbActive = 0;
const _dbQueue = [];
function acquireDb() {
  return new Promise(resolve => {
    if (_dbActive < DB_MAX_CONCURRENT) { _dbActive++; return resolve(); }
    _dbQueue.push(resolve);
  });
}
function releaseDb() {
  if (_dbQueue.length > 0) { const next = _dbQueue.shift(); next(); }
  else { _dbActive--; }
}
const _origGetConn = pool.getConnection.bind(pool);
function poolSaturated() {
  const core = pool.pool;
  if (!core?._allConnections || !core._freeConnections) return true;
  return core._freeConnections.length === 0 && core._allConnections.length >= core.config.connectionLimit;
}
const CONN_TIMEOUT_MS = 4000;
pool.getConnection = async () => {
  if (isDbDown()) throw Object.assign(new Error('Database unavailable'), { code: 'ECONNREFUSED' });
  // The wait for a turn is inside the timeout too. It used to come first and
  // had no limit, so a request queued behind a busy pool waited for good.
  let timer;
  let gotTurn = false;
  let waiter = null;
  const turn = new Promise(resolve => {
    if (_dbActive < DB_MAX_CONCURRENT) { _dbActive++; gotTurn = true; return resolve(); }
    waiter = () => { gotTurn = true; resolve(); };
    _dbQueue.push(waiter);
  });
  // A connection that arrives after the timeout is handed back, not kept: the
  // race used to leave it checked out for good, one pool slot per timeout.
  let pending = null;
  try {
    const conn = await Promise.race([
      turn.then(() => { pending = _origGetConn(); return pending; }),
      new Promise((_, reject) => {
        // Busy only while still queued for a turn or with every pool connection
        // checked out; a turn with a free slot that still waits is the database
        // not answering, and is marked down below.
        timer = setTimeout(() => reject(Object.assign(new Error('DB getConnection timeout'), { code: 'ETIMEDOUT', poolBusy: !gotTurn || poolSaturated() })), CONN_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    _markDbUp();
    const _origRelease = conn.release.bind(conn);
    const _connQuery = conn.query.bind(conn);
    const _connExecute = conn.execute.bind(conn);
    conn.query = async (...args) => {
      const sql = _firstSqlArg(args);
      if (_isSchemaDdl(sql) && !_schemaDdlAllowed()) return _skipSchemaDdl(sql);
      return _connQuery(...args);
    };
    conn.execute = async (...args) => {
      const sql = _firstSqlArg(args);
      if (_isSchemaDdl(sql) && !_schemaDdlAllowed()) return _skipSchemaDdl(sql);
      return _connExecute(...args);
    };
    conn.release = (...args) => { releaseDb(); return _origRelease(...args); };
    return conn;
  } catch (err) {
    clearTimeout(timer);
    if (gotTurn) {
      if (pending) pending.then(late => late.release(), () => {});
      releaseDb();
    } else if (waiter) {
      // Still queued: leave the queue, and take the turn back if it was handed
      // over in the same tick.
      const at = _dbQueue.indexOf(waiter);
      if (at >= 0) _dbQueue.splice(at, 1);
      turn.then(() => releaseDb());
    }
    // Only a database that refuses connections is «down». A busy pool is not:
    // marking it down answered 503 to every request for five seconds, so one
    // slow report took the whole site with it.
    if (err.code === 'ECONNREFUSED' || (err.code === 'ETIMEDOUT' && !err.poolBusy)) _markDbDown();
    throw err;
  }
};

// ── Staff ID resolver ─────────────────────────────────────────────────────────
async function getStaffIdByEmail(email, tenantId) {
  if (!email || !tenantId) return null;
  const [[row]] = await pool.query(
    'SELECT id FROM staff WHERE tenant_id=? AND LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? LIMIT 1',
    [tenantId, (email || '').toLowerCase().trim()]
  ).catch(() => [[null]]);
  return row?.id || null;
}

module.exports = {
  clockContract, pool, cached, cacheInvalidate, cacheInvalidateLocal, dbQuery, dbExecute, getStaffIdByEmail, requireDb, isDbDown };
