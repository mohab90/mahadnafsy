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
    if (err) console.warn('[pool] SET NAMES error:', err.message);
  });
});

// Pool-level error handler — critical on shared hosting where MySQL drops idle connections.
pool.on('error', (err) => {
  console.error('[Pool] Connection error (will auto-recover):', err.message, err.code);
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
  console.error('[Pool] Connection error (will auto-recover):', err.message, err.code);
  _markDbDown();
});

// Middleware: respond 503 immediately instead of hanging when DB is known down
function requireDb(req, res, next) {
  if (isDbDown()) return res.status(503).json({ error: 'DB unavailable — tunnel is down', db: 'disconnected' });
  next();
}

// ── DB Query Helper with auto-retry on stale-connection errors ────────────────
// ECONNREFUSED excluded: tunnel is closed → retrying won't help, propagate immediately
const RETRYABLE = new Set(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'ER_SERVER_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR']);
const _origQuery   = pool.query.bind(pool);
const _origExecute = pool.execute.bind(pool);
pool.query = async (...args) => {
  try {
    const result = await _origQuery(...args);
    _markDbUp();
    return result;
  } catch (err) {
    if (RETRYABLE.has(err.code)) { console.warn('[DB] Stale connection, retrying…', err.code); return await _origQuery(...args); }
    if (err.code === 'ECONNREFUSED') _markDbDown();
    throw err;
  }
};
pool.execute = async (...args) => {
  try {
    const result = await _origExecute(...args);
    _markDbUp();
    return result;
  } catch (err) {
    if (RETRYABLE.has(err.code)) { console.warn('[DB] Stale connection, retrying…', err.code); return await _origExecute(...args); }
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
function cached(key, ttlMs, fn) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  return fn().then(data => {
    if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
    _cache.set(key, { data, ts: Date.now() });
    return data;
  });
}
function cacheInvalidate(...prefixes) {
  if (prefixes.length === 0) { _cache.clear(); return; }
  for (const k of _cache.keys()) {
    if (prefixes.some(p => k.startsWith(p))) _cache.delete(k);
  }
}

// ── Concurrency guard ─────────────────────────────────────────────────────────
const DB_MAX_CONCURRENT = 5;
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
    conn.release = (...args) => { releaseDb(); return _origRelease(...args); };
    return conn;
  } catch (err) {
    releaseDb();
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') _markDbDown();
    throw err;
  }
};

// ── Staff ID resolver ─────────────────────────────────────────────────────────
async function getStaffIdByEmail(email) {
  if (!email) return null;
  const [[row]] = await pool.query(
    'SELECT id FROM staff WHERE LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? LIMIT 1',
    [(email || '').toLowerCase().trim()]
  ).catch(() => [[null]]);
  return row?.id || null;
}

// ── Round-Robin staff auto-assignment ────────────────────────────────────────
async function autoAssignStaff(role) {
  try {
    const rrKey = role === 'SALES' ? 'crm_rr_index' : `crm_rr_${role.toLowerCase()}_index`;
    const [reps] = await pool.query(
      `SELECT id, name FROM staff WHERE role = ? AND is_active = 1 ORDER BY name ASC`, [role]
    );
    if (!reps.length) return null;
    const [rrRows] = await pool.query(
      "SELECT `value` FROM site_config WHERE `key` = ? LIMIT 1", [rrKey]
    );
    const idx = parseInt(rrRows[0]?.value || '0', 10) || 0;
    const rep = reps[idx % reps.length];
    await pool.query(
      "INSERT INTO site_config (`key`,`value`) VALUES (?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [rrKey, String(idx + 1)]
    );
    return { id: rep.id, name: rep.name };
  } catch (e) {
    logger.warn(`[autoAssignStaff] ${role} error: ${e.message}`);
    return null;
  }
}

// Ensures the users auth table exists (idempotent DDL, called at first login/register).
async function ensureUsersTable(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(100) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      is_active TINYINT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

module.exports = { pool, cached, cacheInvalidate, dbQuery, dbExecute, getStaffIdByEmail, autoAssignStaff, ensureUsersTable, requireDb, isDbDown };
