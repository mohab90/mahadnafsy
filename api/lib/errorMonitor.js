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

// ── Threshold alerting (Observability #18) ────────────────────────────────────
// Fires a webhook (ALERT_WEBHOOK_URL — Slack/Discord/generic) when the 5xx rate
// in a rolling window crosses a threshold, or on demand. No-op without the URL.
// Debounced so one incident doesn't spam. Never throws into the request path.
const ALERT_URL = () => process.env.ALERT_WEBHOOK_URL;
const WINDOW_MS = Number(process.env.ALERT_WINDOW_MS || 5 * 60 * 1000);
const THRESHOLD = Number(process.env.ALERT_5XX_THRESHOLD || 10);
const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 15 * 60 * 1000);
let _errTimes = [];
let _recentErrors = [];
let _lastAlert = 0;

async function alert(title, detail) {
  const url = ALERT_URL();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `🚨 ${title}`, title, detail, ts: new Date().toISOString(), app: 'mahad-api' }),
    });
  } catch (e) { logger.warn('[alert] webhook failed', { err: e.message }); }
}

// Call on every 5xx. Tracks a rolling window; alerts (once per cooldown) on spikes.
function recordError(meta) {
  const now = Date.now();
  _errTimes.push(now);
  _errTimes = _errTimes.filter((t) => now - t < WINDOW_MS);
  _recentErrors.push({ ts: new Date(now).toISOString(), ...(meta || {}) });
  _recentErrors = _recentErrors.slice(-50);
  if (_errTimes.length >= THRESHOLD && now - _lastAlert > COOLDOWN_MS) {
    _lastAlert = now;
    alert(`${_errTimes.length} server errors in ${Math.round(WINDOW_MS / 60000)}m`, meta || {});
  }
}

function stats() {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const recent = _recentErrors.filter((e) => Date.parse(e.ts) >= windowStart);
  return {
    active: isActive(),
    windowMs: WINDOW_MS,
    threshold: THRESHOLD,
    errorsInWindow: _errTimes.filter((t) => t >= windowStart).length,
    db503InWindow: recent.filter((e) => Number(e.statusCode) === 503 || e.kind === 'db_unavailable').length,
    financeErrorsInWindow: recent.filter((e) => String(e.flow || e.kind || '').includes('finance') || String(e.flow || '').includes('refund')).length,
    recent: _recentErrors.slice(-10),
  };
}

module.exports = { initErrorMonitor, captureException, isActive, alert, recordError, stats };
