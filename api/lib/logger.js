'use strict';
// ── Structured Logger ─────────────────────────────────────────────────────────
// Lightweight JSON logger — no external deps. Output parseable by log aggregators.
// In production, pipe stdout to a log shipper (e.g. filebeat/loki/papertrail).
//
// Console-compatible: accepts variadic args like console.* so call sites can be
// migrated mechanically (`console.error('x', e)` → `logger.error('x', e)`).
//   - string / number / boolean args are joined into the message
//   - Error args contribute { err, stack } to meta
//   - plain-object args are merged into meta
// Backward compatible with the original (msg, metaObject) signature.
const IS_PROD = process.env.NODE_ENV === 'production';
const SENSITIVE_KEY = /(?:password|passphrase|secret|token|authorization|cookie|api[_-]?key|credential|proof_image|data_url|phone|mobile|email|recipient|cv_url|national_id|address)/i;

function redactString(value) {
  return String(value)
    .replace(/data:[^;,]+;base64,[a-z0-9+/=\r\n]+/gi, '[DATA_URL]')
    .replace(/\bBearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi, '[TOKEN]')
    .replace(/([?&](?:token|secret|key|code|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, '[EMAIL]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]')
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, match => (
      match.replace(/\D/g, '').length >= 10 ? '[PHONE]' : match
    ))
    .replace(/:\/\/([^:/\s]+):([^@\s]+)@/g, '://[REDACTED]:[REDACTED]@');
}

function redactValue(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (depth > 6) return '[TRUNCATED]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactValue(item, seen, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactValue(item, seen, depth + 1),
  ]));
}

// Split variadic args into a single message string + a merged meta object.
function _normalize(args) {
  const parts = [];
  let meta;
  for (const a of args) {
    if (a instanceof Error) {
      meta = { ...(meta || {}), err: a.message, stack: a.stack };
    } else if (a && typeof a === 'object') {
      meta = { ...(meta || {}), ...a };
    } else if (a !== undefined) {
      parts.push(String(a));
    }
  }
  return { msg: parts.join(' '), meta };
}

function _emit(level, ctx, args) {
  const { msg, meta } = _normalize(args);
  const mergedMeta = ctx ? { ...ctx, ...(meta || {}) } : meta;
  const entry = redactValue({ ts: new Date().toISOString(), level, msg, ...(mergedMeta || {}) });
  if (IS_PROD) {
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    const prefix = { info: '\x1b[36m[INFO]\x1b[0m', warn: '\x1b[33m[WARN]\x1b[0m', error: '\x1b[31m[ERROR]\x1b[0m', debug: '\x1b[90m[DEBUG]\x1b[0m' }[level] || '[LOG]';
    const metaStr = mergedMeta && Object.keys(mergedMeta).length ? ' ' + JSON.stringify(mergedMeta) : '';
    console.log(`${prefix} ${entry.ts} ${msg}${metaStr}`); // eslint-disable-line no-console
  }
}

function _make(ctx) {
  return {
    // _write kept for backward compatibility: (level, msg, meta)
    _write: (level, msg, meta) => _emit(level, ctx, meta !== undefined ? [msg, meta] : [msg]),
    info:  (...args) => _emit('info',  ctx, args),
    warn:  (...args) => _emit('warn',  ctx, args),
    error: (...args) => _emit('error', ctx, args),
    debug: (...args) => _emit('debug', ctx, args),
    log:   (...args) => _emit('info',  ctx, args),
    redact: redactValue,
    // Returns a logger that merges `bindings` into every log entry's meta.
    // Used as: const logger = require('../lib/logger').child({ route: 'progress' });
    child: (bindings) => _make({ ...(ctx || {}), ...(bindings || {}) }),
  };
}

module.exports = _make(null);
