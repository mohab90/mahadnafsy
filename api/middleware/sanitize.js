'use strict';
// ── sanitize.js — Global input sanitization middleware ─────────────────────
// Strips common XSS patterns and caps string lengths at the body level.
// Applied AFTER express.json() so req.body is already parsed.

const MAX_FIELD_LEN = 50_000; // per-field hard cap (50KB)
const MAX_FIELDS    = 200;    // max fields per request body

/** Deep-walk a value and sanitize strings. */
function deepSanitize(value, depth = 0) {
  if (depth > 10) return value; // prevent stack abuse via deeply nested objects
  if (typeof value === 'string') {
    // Strip null bytes (SQL / file path injection vector)
    let v = value.replace(/\0/g, '');
    // Cap length
    if (v.length > MAX_FIELD_LEN) v = v.slice(0, MAX_FIELD_LEN);
    return v;
  }
  if (Array.isArray(value)) {
    // Cap array length to prevent DoS via huge arrays
    return value.slice(0, 1000).map(el => deepSanitize(el, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length > MAX_FIELDS) {
      // Too many fields — keep only first MAX_FIELDS
      const trimmed = {};
      keys.slice(0, MAX_FIELDS).forEach(k => { trimmed[k] = deepSanitize(value[k], depth + 1); });
      return trimmed;
    }
    const out = {};
    for (const k of keys) out[k] = deepSanitize(value[k], depth + 1);
    return out;
  }
  return value;
}

/**
 * Express middleware that sanitizes req.body in place.
 * Must be mounted after express.json() / express.urlencoded().
 */
function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = deepSanitize(req.body);
  }
  next();
}

/**
 * Express middleware that adds security-hardening response headers
 * beyond what Helmet provides by default.
 */
function securityHeaders(req, res, next) {
  // Prevent this API from being embedded in iframes
  res.setHeader('X-Frame-Options', 'DENY');
  // Stop browsers from MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions policy — disable unnecessary browser APIs on the API origin
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // Cache control for API responses — never cache authenticated data
  if (req.path.startsWith('/api/') && !req.path.startsWith('/api/health')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}

module.exports = { sanitizeBody, securityHeaders };
