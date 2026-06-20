'use strict';
// ── Structured Logger ─────────────────────────────────────────────────────────
// Lightweight JSON logger — no external deps. Output parseable by log aggregators.
// In production, pipe stdout to a log shipper (e.g. filebeat/loki/papertrail).
const IS_PROD = process.env.NODE_ENV === 'production';
const logger = {
  _write(level, msg, meta) {
    const entry = { ts: new Date().toISOString(), level, msg, ...(meta || {}) };
    if (IS_PROD) {
      process.stdout.write(JSON.stringify(entry) + '\n');
    } else {
      const prefix = { info: '\x1b[36m[INFO]\x1b[0m', warn: '\x1b[33m[WARN]\x1b[0m', error: '\x1b[31m[ERROR]\x1b[0m' }[level] || '[LOG]';
      const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
      console.log(`${prefix} ${entry.ts} ${msg}${metaStr}`);
    }
  },
  info:  (msg, meta) => logger._write('info',  msg, meta),
  warn:  (msg, meta) => logger._write('warn',  msg, meta),
  error: (msg, meta) => logger._write('error', msg, meta),
  // Returns a logger that merges `bindings` into every log entry's meta.
  // Used as: const logger = require('../lib/logger').child({ route: 'progress' });
  child(bindings) {
    const ctx = bindings || {};
    return {
      _write: (level, msg, meta) => logger._write(level, msg, { ...ctx, ...(meta || {}) }),
      info:  (msg, meta) => logger._write('info',  msg, { ...ctx, ...(meta || {}) }),
      warn:  (msg, meta) => logger._write('warn',  msg, { ...ctx, ...(meta || {}) }),
      error: (msg, meta) => logger._write('error', msg, { ...ctx, ...(meta || {}) }),
      child: (more) => logger.child({ ...ctx, ...(more || {}) }),
    };
  },
};

module.exports = logger;
