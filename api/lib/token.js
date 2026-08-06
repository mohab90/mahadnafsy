'use strict';
// ── JWT Token management + Blacklist ─────────────────────────────────────────
// Requires dotenv to be loaded BEFORE this module is required.
const { pool } = require('./db');
const logger   = require('./logger');
const jwt      = require('jsonwebtoken');
const { uuidv4 } = require('./id');
const { resolveSecret } = require('./secretResolver');

let JWT_SECRET = '';
try {
  JWT_SECRET = resolveSecret('JWT_SECRET');
} catch (error) {
  logger.error('JWT_SECRET configuration is invalid', { severity: 'CRITICAL', error: error.message });
  process.exit(1);
}
if (!JWT_SECRET) {
  logger.error('JWT_SECRET is not set in .env — server will exit', { severity: 'CRITICAL' });
  process.exit(1);
}
// Reject weak/placeholder secrets — a short or default secret is brute-forceable.
const WEAK_SECRETS = ['your_jwt_secret_min_48_chars', 'changeme', 'secret', 'jwt_secret'];
if (JWT_SECRET.length < 32 || WEAK_SECRETS.includes(JWT_SECRET.toLowerCase())) {
  logger.error('JWT_SECRET is too weak (must be a random string of at least 32 chars) — server will exit', { severity: 'CRITICAL' });
  process.exit(1);
}
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';
const JWT_MAX_AGE_SECONDS = Math.max(300, Number(process.env.JWT_MAX_AGE_SECONDS) || 7 * 24 * 60 * 60);
const AUTH_COOKIE = `HttpOnly; Path=/; Max-Age=${JWT_MAX_AGE_SECONDS}; SameSite=None; Secure`;

function signAccessToken({ uid, email, tenantId, sessionVersion, sessionId, mfaVerified = false, isStaff = false }) {
  // email is not the identity anchor — uid is (every downstream auth check
  // re-fetches the user row by uid, not by trusting this claim for anything
  // security-critical). A phone-only account genuinely has none, so it's
  // optional here; everything else still has to be present.
  if (!uid || !tenantId || !sessionId || !Number.isInteger(Number(sessionVersion))) {
    throw new Error('Complete access-token identity is required');
  }
  return jwt.sign(
    {
      uid, email, tid: tenantId, sv: Number(sessionVersion),
      sid: sessionId, mfa: mfaVerified === true, jti: uuidv4(),
      // Signed at login so the auth middleware never has to query       // itself — middleware/auth.js is required to route every staff lookup
      // through the tenant-scoped findActiveStaff helper. Grants no permission;
      // it only decides whether concurrent devices are allowed.
      stf: isStaff === true,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie', `authToken=${token}; ${AUTH_COOKIE}`);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'authToken=; HttpOnly; Path=/; Max-Age=0; SameSite=None; Secure');
}

function tokenExpiryMs(payload, fallbackMs = JWT_MAX_AGE_SECONDS * 1000) {
  return payload?.exp ? Number(payload.exp) * 1000 : Date.now() + fallbackMs;
}

// Hybrid: in-memory Map for fast O(1) lookups + MySQL for persistence across restarts.
const tokenBlacklist = new Map(); // jti => expiry ms

async function revokeToken(jti, expMs) {
  tokenBlacklist.set(jti, expMs);
  try {
    const expiresAt = new Date(expMs).toISOString().slice(0, 19).replace('T', ' ');
    await pool.query(
      'INSERT INTO token_blacklist (jti, expires_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at)',
      [jti, expiresAt]
    );
  } catch (e) { logger.warn('[blacklist] DB write failed (token revoked in memory only):', e.message); }
}

// Purge expired entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of tokenBlacklist) if (exp < now) tokenBlacklist.delete(k);
  pool.query('DELETE FROM token_blacklist WHERE expires_at < NOW()').catch(() => {});
}, 60 * 60 * 1000);

// Load non-expired blacklist entries from DB into memory on startup
async function loadBlacklistFromDB() {
  try {
    const [rows] = await pool.query(
      'SELECT jti, UNIX_TIMESTAMP(expires_at)*1000 AS exp_ms FROM token_blacklist WHERE expires_at > NOW()'
    );
    for (const { jti, exp_ms } of rows) tokenBlacklist.set(jti, Number(exp_ms));
    if (rows.length) logger.info(`[blacklist] Loaded ${rows.length} revoked tokens from DB`);
  } catch (e) { logger.warn('[blacklist] Could not load from DB on startup:', e.message); }
}

module.exports = {
  JWT_SECRET, JWT_EXPIRY, JWT_MAX_AGE_SECONDS, tokenBlacklist,
  signAccessToken, setAuthCookie, clearAuthCookie, tokenExpiryMs,
  revokeToken, loadBlacklistFromDB,
};
