'use strict';
/**
 * Optional error monitoring. Activates Sentry ONLY when both:
 *   1. SENTRY_DSN env var is set, and
 *   2. the optional '@sentry/node' package is installed.
 * Otherwise every function is a safe no-op — so the app never breaks if Sentry
 * isn't configured. To enable: `npm i @sentry/node` and set SENTRY_DSN in .env.
 */
const logger = require('./logger');

let _sentry = null;

function initErrorMonitor() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) { logger.info('[errorMonitor] SENTRY_DSN not set — error monitoring disabled (logs only)'); return; }
  try {
    // Lazy optional require — absent package must not crash the server.
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE || 0),
      release: process.env.APP_RELEASE || undefined,
    });
    _sentry = Sentry;
    logger.info('[errorMonitor] Sentry initialized');
  } catch (e) {
    logger.warn('[errorMonitor] SENTRY_DSN set but @sentry/node not installed — run `npm i @sentry/node`', { err: e.message });
  }
}

/** Report an exception (always logs; forwards to Sentry when active). */
function captureException(err, context) {
  try {
    if (_sentry) {
      _sentry.withScope((scope) => {
        if (context) scope.setExtras(context);
        _sentry.captureException(err);
      });
    }
  } catch { /* never let monitoring throw */ }
}

function isActive() { return !!_sentry; }

module.exports = { initErrorMonitor, captureException, isActive };
