'use strict';

// Lightweight input validation helpers for API route handlers.
// Use these at the start of route handlers to reject malformed input early.

const MAX_STRING = 10_000; // chars — per-field default cap

/** Ensure a value is a non-empty string within length limits. */
function isString(v, max = MAX_STRING) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

/** Ensure value is a valid email address (basic RFC 5322 pattern). */
function isEmail(v) {
  return isString(v, 320) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Ensure value is a safe integer within optional bounds. */
function isInt(v, min = -Infinity, max = Infinity) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max;
}

/** Ensure value is a positive safe integer. */
function isPosInt(v) { return isInt(v, 1); }

/** Ensure value is a finite number (float or int). */
function isNumber(v, min = -Infinity, max = Infinity) {
  const n = Number(v);
  return isFinite(n) && n >= min && n <= max;
}

/** Ensure value is a UUID v4 string. */
function isUUID(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/** Ensure value is one of an allowed set. */
function isOneOf(v, allowed) {
  return allowed.includes(v);
}

/** Ensure value is an array (optionally with max length). */
function isArray(v, maxLen = 1000) {
  return Array.isArray(v) && v.length <= maxLen;
}

/** Ensure value is a plain object (not array, not null). */
function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Strip HTML tags from string to prevent stored XSS. */
function stripHtml(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/<[^>]*>/g, '').trim();
}

/** Sanitize a free-text string: trim, strip HTML tags, cap length. */
function sanitizeText(v, max = MAX_STRING) {
  if (typeof v !== 'string') return '';
  return stripHtml(v).slice(0, max);
}

/**
 * Express middleware factory — validates req.body fields using a schema.
 * Schema: { fieldName: (value) => true | 'error message' }
 * Returns 400 with list of errors on failure.
 *
 * @example
 * router.post('/leads', validateBody({
 *   name: v => isString(v, 200) || 'name must be a non-empty string ≤200 chars',
 *   email: v => isEmail(v) || 'invalid email address',
 * }), handler)
 */
function validateBody(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, check] of Object.entries(schema)) {
      const result = check(req.body?.[field]);
      if (result !== true) {
        errors.push({ field, message: result || `${field} is invalid` });
      }
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', errors });
    }
    next();
  };
}

/**
 * Express middleware factory — validates req.params fields.
 * @example
 * router.get('/:id', validateParams({ id: v => isUUID(v) || 'id must be a UUID' }), handler)
 */
function validateParams(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, check] of Object.entries(schema)) {
      const result = check(req.params?.[field]);
      if (result !== true) {
        errors.push({ field, message: result || `${field} param is invalid` });
      }
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', errors });
    }
    next();
  };
}

/**
 * Express middleware factory — validates req.query fields.
 * Only validates fields that are PRESENT in query (optional fields).
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, check] of Object.entries(schema)) {
      if (req.query?.[field] === undefined) continue; // optional — skip absent fields
      const result = check(req.query[field]);
      if (result !== true) {
        errors.push({ field, message: result || `${field} query param is invalid` });
      }
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', errors });
    }
    next();
  };
}

module.exports = {
  isString, isEmail, isInt, isPosInt, isNumber, isUUID, isOneOf, isArray, isObject,
  stripHtml, sanitizeText,
  validateBody, validateParams, validateQuery,
};
