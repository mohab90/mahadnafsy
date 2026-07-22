'use strict';
// ── MySQL Connection Pool + DB helpers ────────────────────────────────────────
// Requires dotenv to be loaded BEFORE this module is required.
const mysql  = require('mysql2/promise');
const logger = require('./logger');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || '127.0.0.1',
  port:    parseInt(  process.env.DB_PORT     || '3306'),
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME,
  waitForConnections: true,
  // Tunable per environment. Shared hosting → keep ~10; dedicated/scaled → raise via env.
  connectionLimit:    parseInt(process.env.DB_POOL_LIMIT  || '10'),
  queueLimit:         parseInt(process.env.DB_QUEUE_LIMIT || '100'),
  connectTimeout:     parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '3000'),
  charset:            'UTF8MB4_UNICODE_CI',
  enableKeepAlive:    true,
  keepAliveInitialDelay: 10000,
});

// Force utf8mb4_unicode_ci collation on every new connection (fixes MariaDB default uca1400)
pool.on('connection', (conn) => {
  conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci", (err) => {
    if (err) logger.warn('[pool] SET NAMES error:', err.message);
  });
});

// Pool-level error handler — critical on shared hosting where MySQL drops idle connections.
pool.on('error', (err) => {
  logger.error('[Pool] Connection error (will auto-recover):', err.message, err.code);
});

// ── DB state tracker — fast-fail when tunnel is known down ───────────────────
// ECONNREFUSED = tunnel not running (port closed) — no point retrying immediately
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
    return res.status(503).json({ error: 'DB unavailable — tunnel is down', db: 'disconnected' });
  }
  next();
}

// ── DB Query Helper with auto-retry on stale-connection errors ────────────────
// ECONNREFUSED excluded: tunnel is closed → retrying won't help, propagate immediately
const RETRYABLE = new Set(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'ER_SERVER_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR']);
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

function _schemaDdlAllowed() {
  return process.env.ALLOW_RUNTIME_SCHEMA_DDL === '1' || process.env.MAHAD_SCHEMA_MIGRATION_ACTIVE === '1';
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
  try {
    const result = await _origQuery(...args);
    _markDbUp();
    return result;
  } catch (err) {
    if (RETRYABLE.has(err.code)) { logger.warn('[DB] Stale connection, retrying…', err.code); return await _origQuery(...args); }
    if (err.code === 'ECONNREFUSED') _markDbDown();
    throw err;
  }
};
pool.execute = async (...args) => {
  const sql = _firstSqlArg(args);
  if (_isSchemaDdl(sql) && !_schemaDdlAllowed()) return _skipSchemaDdl(sql);
  try {
    const result = await _origExecute(...args);
    _markDbUp();
    return result;
  } catch (err) {
    if (RETRYABLE.has(err.code)) { logger.warn('[DB] Stale connection, retrying…', err.code); return await _origExecute(...args); }
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
function cacheInvalidate(...prefixes) {
  if (prefixes.length === 0) { _cache.clear(); _pendingCache.clear(); return; }
  for (const k of _cache.keys()) {
    if (prefixes.some(p => k.startsWith(p))) _cache.delete(k);
  }
  for (const k of _pendingCache.keys()) {
    if (prefixes.some(p => k.startsWith(p))) _pendingCache.delete(k);
  }
}

// ── Concurrency guard ─────────────────────────────────────────────────────────
// Tunable per environment — should track connectionLimit above, not sit fixed
// below it (a lower hardcoded value throttles requests even when the pool has
// spare connections).
const DB_MAX_CONCURRENT = parseInt(process.env.DB_MAX_CONCURRENT || process.env.DB_POOL_LIMIT || '10');
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
const CONN_TIMEOUT_MS = 4000;
pool.getConnection = async () => {
  if (isDbDown()) throw Object.assign(new Error('DB unavailable — tunnel is down'), { code: 'ECONNREFUSED' });
  await acquireDb();
  try {
    const conn = await Promise.race([
      _origGetConn(),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('DB getConnection timeout'), { code: 'ETIMEDOUT' })), CONN_TIMEOUT_MS)),
    ]);
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
    releaseDb();
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') _markDbDown();
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

// ── Round-Robin staff auto-assignment ────────────────────────────────────────
async function autoAssignStaff(role, tenantId = 'tenant-default') {
  try {
    const normalizedRole = String(role || '').toUpperCase();
    let workloadJoin = '';
    if (normalizedRole === 'SALES') {
      workloadJoin = `LEFT JOIN leads w ON w.tenant_id=s.tenant_id
        AND w.assigned_sales_id=s.id AND w.hidden=0 AND LOWER(w.status) NOT IN ('converted','lost','closed')`;
    } else if (normalizedRole === 'COLLECTION') {
      workloadJoin = `LEFT JOIN subscribers w ON w.tenant_id=s.tenant_id
        AND w.assigned_cs_id=s.id AND w.deleted_at IS NULL AND w.is_active=1`;
    }
    const countExpr = workloadJoin ? 'COUNT(w.id)' : '0';
    const [reps] = await pool.query(
      `SELECT s.id, s.name, ${countExpr} AS active_workload
       FROM staff s ${workloadJoin}
       WHERE s.tenant_id=? AND s.role=? AND s.is_active=1 AND s.deleted_at IS NULL
       GROUP BY s.id, s.name
       ORDER BY active_workload ASC, s.name ASC, s.id ASC
       LIMIT 1`,
      [tenantId, normalizedRole]
    );
    return reps[0] ? { id: reps[0].id, name: reps[0].name } : null;
  } catch (e) {
    logger.warn(`[autoAssignStaff] ${role} error: ${e.message}`);
    return null;
  }
}

// Ensures the users auth table exists. Called from the register/login/OTP
// request handlers (self-healing if the table is ever missing), but the actual
// DDL only runs once per process — every request after the first successful
// check is a single in-memory boolean read, not a CREATE TABLE round-trip on
// the hottest, most latency-sensitive path in the app.
let _usersTableEnsured = false;
async function ensureUsersTable(conn) {
  if (_usersTableEnsured) return;
  if (process.env.ALLOW_RUNTIME_SCHEMA_DDL !== '1') {
    _usersTableEnsured = true;
    logger.warn('[schema] ensureUsersTable skipped; run api/migrations/054_v25_auth_refund_monitoring_hardening.sql before production');
    return;
  }
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(100) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      is_active TINYINT DEFAULT 1,
      login_count INT DEFAULT 0,
      last_login DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_users_tenant_email (tenant_id, email(191))
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  _usersTableEnsured = true;
}

module.exports = { pool, cached, cacheInvalidate, dbQuery, dbExecute, getStaffIdByEmail, autoAssignStaff, ensureUsersTable, requireDb, isDbDown };
