'use strict';
// ── sanitize.js — Global input sanitization middleware ─────────────────────
// Strips common XSS patterns and caps string lengths at the body level.
// Applied AFTER express.json() so req.body is already parsed.

const MAX_FIELD_LEN = 50_000; // per-field hard cap (50KB)
// Too much is REFUSED, not trimmed. These used to be 200 fields and 1000 array
// items, cut silently: a 2,000-row import reached its route as 1,000 rows, and a
// bulk action on 1,500 selected clients ran on 1,000 — both answered «ok». A
// request over the limit now fails loudly (413) so nobody believes the rest was
// done. The limits themselves are generous enough for every real screen.
const MAX_FIELDS    = 1_000;  // max fields per object
const MAX_ARRAY_LEN = 5_000;  // max items per array

class BodyTooLargeError extends Error {
  constructor(message) { super(message); this.name = 'BodyTooLargeError'; this.status = 413; }
}

// Keys whose value is a number or a phone typed by a person. Egyptian keyboards
// (and anything pasted from WhatsApp) produce Arabic-Indic digits — ٠١٠١٢٣٤٥٦٧٨ —
// which every `\D` and `\d` in the system treats as not-a-digit, so a phone
// typed that way was silently saved blank and an amount became NaN. Only these
// fields are converted: the same digits inside a note are the writer's own.
const NUMERIC_KEY = /(phone|mobile|whatsapp|^tel$|amount|price|expected|discount|nationalid|national_id|transactionid|transaction_id|fromaccount|from_account|number|^pct$|percent|rate$)/i;
const latinDigits = value => value
  .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/\u066b/g, '.')   // Arabic decimal separator
  .replace(/\u066c/g, '');   // Arabic thousands separator
// A picture sent as a data URL is the one string allowed to be long: cut at
// 50KB it was saved as a broken image — every transfer receipt over ~37 KB, and
// every event picture. The JSON body itself stops at 10 MB (httpApp.js).
const MAX_IMAGE_LEN = 8_000_000;
const IMAGE_DATA_URL = /^data:image\/[a-z+.-]+;base64,/i;

/** Deep-walk a value and sanitize strings. */
function deepSanitize(value, depth = 0, key = '') {
  if (depth > 10) return value; // prevent stack abuse via deeply nested objects
  if (typeof value === 'string') {
    // Strip null bytes (SQL / file path injection vector)
    let v = value.replace(/\0/g, '');
    if (key && NUMERIC_KEY.test(key)) v = latinDigits(v);
    // Cap length
    const cap = IMAGE_DATA_URL.test(v) ? MAX_IMAGE_LEN : MAX_FIELD_LEN;
    if (v.length > cap) v = v.slice(0, cap);
    return v;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LEN) {
      throw new BodyTooLargeError(`القائمة (${key || 'body'}) فيها ${value.length} عنصر — الحد الأقصى ${MAX_ARRAY_LEN}. قسّمها على دفعات.`);
    }
    return value.map(el => deepSanitize(el, depth + 1, key));
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length > MAX_FIELDS) {
      throw new BodyTooLargeError(`الكائن (${key || 'body'}) فيه ${keys.length} حقل — الحد الأقصى ${MAX_FIELDS}.`);
    }
    const out = {};
    for (const k of keys) out[k] = deepSanitize(value[k], depth + 1, k);
    return out;
  }
  return value;
}

/**
 * Express middleware that sanitizes req.body in place.
 * Must be mounted after express.json() / express.urlencoded().
 */
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    try {
      req.body = deepSanitize(req.body);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return res.status(413).json({ error: error.message, code: 'BODY_TOO_LARGE' });
      }
      throw error;
    }
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

module.exports = { sanitizeBody, securityHeaders, deepSanitize, latinDigits, MAX_ARRAY_LEN };
