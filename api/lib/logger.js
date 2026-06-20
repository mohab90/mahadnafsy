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
  const entry = { ts: new Date().toISOString(), level, msg, ...(mergedMeta || {}) };
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
    // Returns a logger that merges `bindings` into every log entry's meta.
    // Used as: const logger = require('../lib/logger').child({ route: 'progress' });
    child: (bindings) => _make({ ...(ctx || {}), ...(bindings || {}) }),
  };
}

module.exports = _make(null);
