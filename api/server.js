// ══════════════════════════════════════════════════════════════
// server.js — REST API للمعهد الجديد (MySQL Backend)
// Node.js + Express + mysql2
// ══════════════════════════════════════════════════════════════

'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT           = parseInt(process.env.PORT || '3001', 10);

const express        = require('express');
const compression    = require('compression');
const cors           = require('cors');
const helmet         = require('helmet');
const { uuidv4 } = require('./lib/id');
const bcrypt         = require('bcryptjs');
const crypto         = require('crypto');

// ── Modules ───────────────────────────────────────────────────────────────────
const logger       = require('./lib/logger');
const { mailer, htmlEmail, sendEmail } = require('./lib/email');
const { pool, cacheInvalidate, getStaffIdByEmail, autoAssignStaff } = require('./lib/db');
const { sanitize, validate, calcLeadScoreServer, tryJson, parseCrm, parseLimit, parseOffset } = require('./lib/helpers');
const { sendWhatsApp } = require('./lib/whatsapp');
const { renderTemplate } = require('./lib/messageTemplates');
const { COURSE_COLS, mapCourse, mapBundle, mapTherapist, getNextClientCode } = require('./lib/mappers');
const { ADMIN_EMAILS, requireAuth, requireAdmin, requireAdminOrOnlineManagerOrCollection, requireAdminOrStaff, requirePermission } = require('./middleware/auth');
const { adminLimiter, paymobLimiter, whatsappSendLimiter } = require('./middleware/rateLimits');
const { createNotification } = require('./lib/notification');
const { logPaymentAudit, postJournalEntry, _paymentAccountCode } = require('./lib/finance');
const { logLeadEvent } = require('./lib/crm');
const { enqueueEmailSequence } = require('./lib/emailSequence');
const { syncAllConfiguredSheets, DEFAULT_GSHEETS } = require('./lib/sheets');
const { VALID_BRANCHES, VALID_PAY_TYPES, VALID_SOURCES } = require('./constants/permissions');
const gsheetsRouter = require('./routes/gsheets');
const monitoringRouter = require('./routes/monitoring');
const adminMaintenanceRouter = require('./routes/admin-maintenance');
const funnelRouter = require('./routes/funnel');
const automationRouter = require('./routes/automation');
const campaignsRouter  = require('./routes/campaigns');
const supportRouter    = require('./routes/support'); // Customer-Service Hub
const adminUtilsRouter = require('./routes/admin-utils');
const financeRouter   = require('./routes/finance');
const analyticsRouter = require('./routes/analytics');
const miscRouter     = require('./routes/misc');
const notificationsRouter = require('./routes/notifications');
const ordersRouter = require('./routes/orders');
const configRouter = require('./routes/config');
const communityRouter = require('./routes/community');
const inboxRouter = require('./routes/inbox');
const daqqiRoundsRouter = require('./routes/daqqi-rounds');
const publicOrdersRouter   = require('./routes/public-orders');
const imageProxyRouter      = require('./routes/imageProxy');
const certificatesRouter   = require('./routes/certificates');
const coreRouter            = require('./routes/core');
const adminRouter           = require('./routes/admin');
const lmsAdminRouter        = require('./routes/lms-admin');
const paymentsRouter        = require('./routes/payments');
const crmToolsRouter        = require('./routes/crm-tools');
const subscriberPayRouter   = require('./routes/subscriber-payments');
const paymentProofsRouter   = require('./routes/payment-proofs');
const whatsappAdminRouter   = require('./routes/whatsapp-admin');
const fbWebhooksRouter      = require('./routes/fb-webhooks');
const accountingRouter      = require('./routes/accounting');
const accountingErpRouter   = require('./routes/accounting-erp');
const saasAdminRouter       = require('./routes/saas-admin');
const lmsRouter             = require('./routes/lms');
const hrRouter     = require('./routes/hr');
const authRouter   = require('./routes/auth');
const publicRouter = require('./routes/public');
const paymentsAdminRouter   = require('./routes/payments-admin');
const { loadBlacklistFromDB } = require('./lib/token');
const { registerStartupTasks } = require('./lib/startupTasks');

// ── Global error guards (registered before any I/O) ──────────────────────────
process.on('uncaughtException', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Port is busy — another instance is already running (e.g. supervisor started one, PM2 tried too).
    // DO NOT kill the existing process — it's the healthy one. Just exit so supervisor backs off.
    const port = err.port || process.env.PORT || 3001;
    logger.warn(`[EADDRINUSE] Port ${port} is busy — another instance running, exiting quietly (supervisor handles restart)`);
    setTimeout(() => { process.exit(1); }, 500);
    return;
  }
  logger.error('[uncaughtException]', err.message, err.stack);
  try { require('./lib/errorMonitor').captureException(err, { kind: 'uncaughtException' }); } catch { /* noop */ }
  // Do NOT exit — let the server keep running despite the error
});
process.on('unhandledRejection', (reason) => {
  logger.error('[unhandledRejection]', reason);
  try { require('./lib/errorMonitor').captureException(reason instanceof Error ? reason : new Error(String(reason)), { kind: 'unhandledRejection' }); } catch { /* noop */ }
  // Do NOT exit — promises rejecting should never kill the server
});
// Graceful shutdown on SIGTERM — allow in-flight requests to drain before exiting.
// Deploy uses pkill (SIGTERM) then SIGKILL after a delay — two rapid SIGTERMs = intentional stop.
// Hostinger shared hosting also sends isolated SIGTERMs periodically for resource management —
// those must be IGNORED. Only shut down gracefully when 2+ SIGTERMs arrive within 5 seconds.
let _sigtermCount = 0;
let _sigtermFirst = 0;
let _isShuttingDown = false;
let _httpServer = null; // assigned after app.listen()
process.on('SIGTERM', () => {
  _sigtermCount++;
  const now = Date.now();
  const mem = process.memoryUsage();
  const rapid = (_sigtermCount > 1) && (now - _sigtermFirst < 5000);
  logger.info(`[SIGTERM] #${_sigtermCount} received — memRss=${Math.round(mem.rss/1048576)}MB — ${rapid ? 'rapid=yes → shutting down' : 'isolated → ignoring'}`);
  if (_sigtermCount === 1) _sigtermFirst = now;
  if (!rapid) return; // ignore isolated SIGTERMs — hosting sends these periodically
  if (_isShuttingDown) return;
  _isShuttingDown = true;
  // Stop accepting new connections, drain in-flight, then exit
  if (_httpServer) {
    _httpServer.close(() => {
      pool.end().catch(() => {}).finally(() => {
        logger.info('[SIGTERM] graceful shutdown complete');
        process.exit(0);
      });
    });
    // Hard-kill after 15s in case something hangs
    setTimeout(() => { logger.info('[SIGTERM] force exit after 15s timeout'); process.exit(0); }, 15000);
  } else {
    setTimeout(() => process.exit(0), 3000);
  }
});
// Log memory usage every 10 minutes so we can correlate with crashes
setInterval(() => {
  const mem = process.memoryUsage();
  logger.info(`[memory] rss=${Math.round(mem.rss/1048576)}MB heap=${Math.round(mem.heapUsed/1048576)}MB/${Math.round(mem.heapTotal/1048576)}MB ext=${Math.round(mem.external/1048576)}MB`);
}, 10 * 60 * 1000);

// Startup schema/data tasks live in lib/startupTasks.js until fully converted to numbered SQL migrations.
registerStartupTasks({ pool, tryJson, VALID_PAY_TYPES, VALID_SOURCES, sendWhatsApp, uuidv4 });

const { execFile, exec } = require('child_process');
const _fs       = require('fs');
const _os       = require('os');
const _pm2NodeBin = '/opt/alt/alt-nodejs22/root/usr/bin/node';
const _pm2Bin   = require('path').join(__dirname, 'local_modules/node_modules/pm2/bin/pm2');
const _pm2Home  = process.env.PM2_HOME || require('path').join(__dirname, '.pm2');
const _watchdog = require('path').join(__dirname, 'watchdog.sh');
const _srvPort  = process.env.PORT || '3001';
// watchdog.log = rolling 500-line operational log (not for crashes)
// crash-history.log = permanent append-only crash record (NEVER trimmed)
const _crashHistoryLog = require('path').join(__dirname, 'crash-history.log');
const _cronLine = `*/1 * * * * /bin/bash ${_watchdog} >> ${require('path').join(__dirname, 'watchdog.log')} 2>&1`;

// Record this startup in crash-history.log with cumulative restart count
(function recordStartup() {
  try {
    const existing = _fs.existsSync(_crashHistoryLog) ? _fs.readFileSync(_crashHistoryLog, 'utf8') : '';
    const crashCount = (existing.match(/\[CRASH\]/g) || []).length;
    const restartCount = (existing.match(/\[START\]/g) || []).length;
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    _fs.appendFileSync(_crashHistoryLog,
      `${ts} [START] Server started — cumulative restarts: ${restartCount + 1}, crashes recorded: ${crashCount}\n`
    );
  } catch (_) {}
})();

// Clear PM2 dump on every startup so PM2 resurrect never auto-starts a competing server.js
// (supervisor.js is the process manager now — PM2 must not interfere)
(function clearPm2Dump() {
  try {
    const dumpFile = require('path').join(_pm2Home, 'dump.pm2');
    if (_fs.existsSync(dumpFile)) {
      _fs.writeFileSync(dumpFile, '{}');
      logger.info('[pm2-dump] dump.pm2 cleared — PM2 resurrect will not start competing processes');
    }
  } catch (_) {}
})();

// Write watchdog.sh content to disk on every startup (self-healing)
const _watchdogContent = `#!/bin/bash
# Mahad API Watchdog — auto-restart via supervisor.js if port ${_srvPort} is down
NODE='/opt/alt/alt-nodejs22/root/usr/bin/node'
SUPERVISOR='${require('path').join(__dirname, 'supervisor.js')}'
LOG='${require('path').join(__dirname, 'watchdog.log')}'
CRASH_LOG='${_crashHistoryLog}'
APP_DIR='${__dirname}'
TS=$(date '+%Y-%m-%d %H:%M:%S')

# WhatsApp alert helper — reads secrets from .env at runtime (never embedded in this file)
ENV_FILE="$APP_DIR/.env"
read_env() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'"; }
WA_TOKEN=$(read_env WHATSAPP_TOKEN)
WA_PHONE_ID=$(read_env WHATSAPP_PHONE_ID)
WA_ADMIN_PHONE=$(read_env ADMIN_WHATSAPP_PHONE)
send_wa_alert() {
  local MSG="$1"
  if [ -n "$WA_TOKEN" ] && [ -n "$WA_PHONE_ID" ] && [ -n "$WA_ADMIN_PHONE" ]; then
    curl -s -X POST "https://graph.facebook.com/v20.0/$WA_PHONE_ID/messages" \\
      -H "Authorization: Bearer $WA_TOKEN" \\
      -H "Content-Type: application/json" \\
      -d "{\\"messaging_product\\":\\"whatsapp\\",\\"to\\":\\"$WA_ADMIN_PHONE\\",\\"type\\":\\"text\\",\\"text\\":{\\"body\\":\\"$MSG\\"}}" \\
      >> $LOG 2>&1
  fi
}

# ── Check health (localhost:${_srvPort}) ─────────────────────────────────────
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://localhost:${_srvPort}/api/health 2>/dev/null)
if [ "$HTTP" != "200" ]; then
  echo "$TS [CRASH] Server down (HTTP=$HTTP) — recovering via supervisor.js" >> $CRASH_LOG
  echo "$TS [WATCHDOG] Server down (HTTP=$HTTP) — starting supervisor.js..." >> $LOG
  send_wa_alert "🚨 Mahad API توقف (HTTP=$HTTP) — جاري إعادة التشغيل $TS"

  # Kill PM2 daemon so it won't resurrect a competing server.js
  NODE='/opt/alt/alt-nodejs22/root/usr/bin/node'
  SUPERVISOR='${require('path').join(__dirname, 'supervisor.js')}'
  PM2='${require('path').join(__dirname, 'local_modules/node_modules/pm2/bin/pm2')}'
  PM2_HOME='${process.env.PM2_HOME || require('path').join(__dirname, '.pm2')}'
  PM2_HOME="$PM2_HOME" $NODE $PM2 kill 2>/dev/null || true
  sleep 1
  # Kill stale server.js and supervisor.js node processes only — NOT this watchdog script.
  # We match the specific script names to avoid killing the bash process running watchdog.sh.
  SELF_PID=$$
  for f in /proc/[0-9]*/cmdline; do
    PID=$(echo "$f" | cut -d/ -f3)
    [ "$PID" = "$SELF_PID" ] && continue
    grep -qz "mahad-api/server\.js\|mahad-api/supervisor\.js" "$f" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  done
  sleep 3

  # Start fresh supervisor
  nohup $NODE $SUPERVISOR >> $APP_DIR/server.log 2>&1 &
  SPID=$!
  echo "$TS [CRASH] supervisor.js started PID=$SPID" >> $CRASH_LOG
  echo "$TS [WATCHDOG] supervisor PID=$SPID" >> $LOG
  send_wa_alert "⚠️ Mahad API restarting via supervisor PID=$SPID"

  sleep 15
  HTTP2=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://localhost:${_srvPort}/api/health 2>/dev/null)
  if [ "$HTTP2" = "200" ]; then
    echo "$TS [RECOVERED] API back via supervisor" >> $CRASH_LOG
    echo "$TS [WATCHDOG] OK after restart" >> $LOG
    send_wa_alert "✅ Mahad API عاد للعمل via supervisor"
  else
    echo "$TS [CRASH] Recovery failed HTTP2=$HTTP2" >> $CRASH_LOG
    echo "$TS [WATCHDOG] Recovery failed HTTP2=$HTTP2" >> $LOG
    send_wa_alert "❌ Mahad API فشل الإصلاح HTTP=$HTTP2"
  fi
  # Trim operational log only (NOT crash-history)
  tail -500 $LOG > $LOG.tmp && mv $LOG.tmp $LOG
fi
`;
try {
  _fs.writeFileSync(_watchdog, _watchdogContent, { mode: 0o755 });
  logger.info('[watchdog] watchdog.sh written to', _watchdog);
} catch (e) {
  logger.warn('[watchdog] Could not write watchdog.sh:', e.message);
}
(function installCron() {
  const bins = ['/usr/bin/crontab', '/bin/crontab', '/usr/local/bin/crontab'];
  const tryBin = (i) => {
    if (i >= bins.length) {
      // Fallback: write directly to spool file (works on some Hostinger configs)
      const username = _os.userInfo().username;
      [
        `/var/spool/cron/crontabs/${username}`,
        `/var/spool/cron/${username}`,
      ].forEach(f => exec(
        `grep -qF watchdog.sh ${f} 2>/dev/null || (echo "${_cronLine}" >> ${f} && chmod 600 ${f} && echo "[cron] watchdog written to ${f}")`,
        () => {}
      ));
      return;
    }
    exec(`[ -x "${bins[i]}" ] && (${bins[i]} -l 2>/dev/null | grep -vF watchdog.sh; echo "${_cronLine}") | ${bins[i]} - && echo "[cron] installed via ${bins[i]}"`,
      (e, out) => {
        if (!e && out && out.includes('[cron]')) logger.info(out.trim());
        else tryBin(i + 1);
      });
  };
  tryBin(0);
})();

// ── Proactive memory auto-heal ────────────────────────────────────────────────
// Threshold at 170MB — normal RSS is 80-95MB, peak during gsheet sync is ~134MB.
// We only trigger if there's a genuine memory leak (not a normal fluctuation).
// Watchdog cron (every 5 min) restarts the server after process.exit(0).
// NOTE: Do NOT use pm2 reload here — server is started via nohup, not PM2,
//       so pm2 reload causes a port-3001 conflict that kills the server entirely.
const MEMORY_HEAL_THRESHOLD = (parseInt(process.env.DEV_MEMORY_LIMIT_MB) || 170) * 1024 * 1024; // 170 MB default; override via DEV_MEMORY_LIMIT_MB for local dev
let _healInProgress = false;
setInterval(() => {
  const memUsed = process.memoryUsage().rss;
  if (memUsed > MEMORY_HEAL_THRESHOLD && !_healInProgress) {
    _healInProgress = true;
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const memMB = (memUsed / 1024 / 1024).toFixed(1);
    // WARN (not info) + a webhook alert so a genuine leak SURFACES instead of being
    // silently masked by restarts. Frequent auto-heals = investigate a leak.
    logger.warn(`[auto-heal] Memory ${memMB}MB > threshold ${Math.round(MEMORY_HEAL_THRESHOLD/1048576)}MB — clean restart (watch frequency: frequent = leak)`);
    try {
      require('./lib/errorMonitor').alert('Memory auto-heal restart', {
        rssMB: memMB, thresholdMB: Math.round(MEMORY_HEAL_THRESHOLD / 1048576),
        note: 'Occasional is fine; FREQUENT restarts indicate a real memory leak — investigate.',
      });
    } catch (_) {}
    try {
      _fs.appendFileSync(_crashHistoryLog,
        `${ts} [AUTO-HEAL] Clean exit at ${memMB}MB (threshold ${Math.round(MEMORY_HEAL_THRESHOLD/1048576)}MB)\n`
      );
    } catch (_) {}
    // Give in-flight requests 3s to drain, then exit cleanly
    // The cron watchdog (every 5 min) will restart server.js automatically
    setTimeout(() => process.exit(0), 3000);
  }
}, 30_000); // check every 30s

// PM2 dump clear every 30 min — prevents pm2 resurrect from starting competing instances
// We clear the dump file so pm2 resurrect has nothing to start (empty apps list)
setInterval(() => {
  try {
    const _dumpFile = require('path').join(_pm2Home, 'dump.pm2');
    const _dumpBak  = require('path').join(_pm2Home, 'dump.pm2.bak');
    try { _fs.writeFileSync(_dumpFile, '{"apps":[]}', 'utf8'); } catch (_) {}
    try { _fs.writeFileSync(_dumpBak,  '{"apps":[]}', 'utf8'); } catch (_) {}
    logger.info('[pm2-dump] cleared — resurrect blocked');
  } catch (_) {}
}, 30 * 60 * 1000);

// Background jobs (customer-messaging crons, outbox/worker drain, gsheet sync,
// daily backup, self-ping) run ONLY in production — or when explicitly forced
// via ENABLE_LOCAL_JOBS=1. A local/dev instance connects to the SAME production
// DB over the SSH tunnel, so without this guard it would send real WhatsApp/email
// to customers, import leads, and run mysqldump. Prod sets NODE_ENV=production,
// so its behaviour is unchanged.
const ENABLE_BACKGROUND_JOBS = process.env.NODE_ENV === 'production' || process.env.ENABLE_LOCAL_JOBS === '1';

// ── Google Sheets auto-sync every 30 minutes ──────────────────────────────
// Runs on startup (after 20s to allow DB pool to stabilise) then every 30 min
if (ENABLE_BACKGROUND_JOBS) {
  setTimeout(() => {
    syncAllConfiguredSheets()
      .then(r => { if (r && r.imported > 0) logger.info(`[GSheet startup-sync] Imported ${r.imported} new leads`); })
      .catch(e => logger.warn('[GSheet startup-sync] error:', e.message));
  }, 20_000);

  setInterval(() => {
    syncAllConfiguredSheets()
      .then(r => { if (r && r.imported > 0) logger.info(`[GSheet auto-sync] Imported ${r.imported} new leads`); })
      .catch(e => logger.warn('[GSheet auto-sync] error:', e.message));
  }, 30 * 60 * 1000);
}

if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
  logger.error('[FATAL] DB_USER / DB_PASSWORD / DB_NAME must be set in .env');
  process.exit(1);
}

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1); // behind Apache/Nginx proxy on Hostinger
app.use(compression()); // gzip/brotli — reduces JSON payload size by ~60-80%

const _rawOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
// In production, strip all localhost origins — they must never be whitelisted on the live server
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? _rawOrigins.filter(o => o && !o.includes('localhost') && !o.includes('127.0.0.1'))
  : _rawOrigins;
const isLocalDevOrigin = (origin) => (
  process.env.NODE_ENV !== 'production'
  && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin)
);
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || isLocalDevOrigin(origin)) return cb(null, true);
    cb(null, false); // Reject silently — avoids unhandled error event crashing the process
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  credentials: true,
};
// Handle CORS preflight (OPTIONS) explicitly for all routes — defense in depth.
// Without this, some HTTP clients and proxies that send OPTIONS first won't get the headers.
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
// Security headers — CSP blocks inline scripts/frames on the API origin
// (API responses are JSON; no HTML rendering occurs here so strict CSP is safe)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'none'"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
      baseUri:    ["'self'"],
    },
  },
}));

// Body size: 10 MB (for base64 image uploads in payment proofs)
// verify callback stores raw body for FB webhook HMAC verification
app.use(express.json({ limit: '10mb', verify: (_req, _res, buf) => { _req.rawBody = buf; } }));

// Security hardening: deep-sanitize all request bodies + extra response headers
const { sanitizeBody, securityHeaders } = require('./middleware/sanitize');
app.use(sanitizeBody);
app.use(securityHeaders);

// Request ID middleware — assigns a short unique ID to every request.
// Included in X-Request-ID response header and req.reqId for log correlation.
app.use((req, res, next) => {
  req.reqId = Math.random().toString(36).slice(2, 10).toUpperCase();
  res.setHeader('X-Request-ID', req.reqId);
  next();
});

// Multi-tenancy seam (Phase 2): resolves req.tenantId from sub-domain/header/JWT.
// Single-tenant today → always 'tenant-default'; no behavior change. See docs/MULTI-TENANCY.md.
app.use(require('./middleware/tenantContext').resolveTenant);

// Structured HTTP access log — one JSON line per request (method/path/status/ms).
// Skips health probes to avoid flooding logs. Warn-level for 5xx so they stand out.
const _httpLogger = require('./lib/logger');
app.use((req, res, next) => {
  if (req.path === '/api/health/live' || req.path === '/api/health') return next();
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const meta = { reqId: req.reqId, method: req.method, path: req.path, status: res.statusCode, ms };
    if (res.statusCode >= 500) { _httpLogger.error('http', meta); try { require('./lib/errorMonitor').recordError(meta); } catch { /* noop */ } }
    else if (res.statusCode >= 400) _httpLogger.warn('http', meta);
    else _httpLogger.info('http', meta);
  });
  next();
});

app.get('/api/health/live', (_req, res) => {
  res.json({ status: 'ok', service: 'mahad-api', time: new Date().toISOString() });
});

// Detailed health — distinguishes DB-down (tunnel) from app-down, for monitoring/alerting.
app.get('/api/health/detailed', async (_req, res) => {
  const t0 = Date.now();
  let db = { ok: false, ms: null, error: null };
  try {
    const { pool } = require('./lib/db');
    await pool.query('SELECT 1');
    db = { ok: true, ms: Date.now() - t0, error: null };
  } catch (e) {
    db = { ok: false, ms: Date.now() - t0, error: e.code || e.message };
  }
  const mem = process.memoryUsage();
  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? 'ok' : 'degraded',
    service: 'mahad-api',
    db,                         // {ok, ms, error} — error like 'ECONNREFUSED' => tunnel down
    uptimeSec: Math.round(process.uptime()),
    rssMB: Math.round(mem.rss / 1048576),
    errorMonitor: require('./lib/errorMonitor').isActive() ? 'active' : 'logs-only',
    time: new Date().toISOString(),
  });
});

// Request timeout — kill long-hanging requests after 45s to free pool connections
app.use((req, res, next) => {
  res.setTimeout(45000, () => {
    if (!res.headersSent) res.status(408).json({ error: 'Request timeout' });
  });
  next();
});

// ── Paymob gateway is suspended — no HMAC check required while inactive ────
// Re-enable this check when the Paymob account is reactivated:
// if (!process.env.PAYMOB_HMAC_SECRET) {
//   logger.error('PAYMOB_HMAC_SECRET is not set — payment verification DISABLED');
// }

// ── Additional ENV startup warnings ─────────────────────────────────────────
// These are non-fatal but critical operational warnings
const _criticalEnvVars = [
  { key: 'DB_HOST',      purpose: 'MySQL DB connection' },
  { key: 'DB_USER',      purpose: 'MySQL DB connection' },
  { key: 'DB_PASSWORD',  purpose: 'MySQL DB connection' },
  { key: 'DB_NAME',      purpose: 'MySQL DB connection' },
];
_criticalEnvVars.forEach(({ key, purpose }) => {
  if (!process.env[key]) {
    logger.error(`[CONFIG] ⚠️  ${key} is not set in .env (${purpose}) — server may fail to start correctly.`);
  }
});

// ── Admin Audit Middleware ────────────────────────────────────────────────────
// Auto-logs all successful admin mutations (POST/PUT/PATCH/DELETE) to activity_logs.
// Uses res.on('finish') so req.user is fully populated before logging.
function auditAdmin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        const actor    = req.user?.email || req.user?.uid || 'admin';
        const rawPath  = req.originalUrl.split('?')[0];
        const entity   = rawPath.replace(/^\/api\/admin\//, '').split('/')[0] || 'admin';
        const action   = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[req.method];
        const entityId = (req.params?.id || req.body?.id || '').toString().substring(0, 36) || null;
        const label    = `${action} ${rawPath}`.substring(0, 255);
        pool.query(
          'INSERT INTO activity_logs (id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?)',
          [uuidv4(), action, entity, entityId || null, label, actor]
        ).catch(() => {});
      } catch (_) {}
    }
  });
  next();
}
// Apply audit to all admin mutation routes
app.use('/api/admin', auditAdmin);
// Apply rate limiter to all /api/admin/* routes (after auth audit, before handlers)
app.use('/api/admin', adminLimiter);

// ── In-memory online presence tracking ───────────────────────────────────────
const { onlineMap } = require('./lib/onlineUsers');
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000; // evict after 5 min silence
  for (const [uid, data] of onlineMap.entries()) {
    if (data.lastSeen < cutoff) onlineMap.delete(uid);
  }
}, 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN IP WHITELIST — opt-in network guard (set IP_WHITELIST_ENFORCE=true)
// ─────────────────────────────────────────────────────────────────────────────
// Enforced ONLY on /api/admin/* and ONLY when explicitly enabled via env, so a
// code deploy can never silently lock anyone out. Anti-lockout safeguards:
//   • the management route (/api/admin/ip-whitelist) is always exempt, so an admin
//     whose IP isn't listed can still open the panel and fix the list;
//   • an empty list means "disabled" (fail-open) — you can't lock yourself out by
//     enabling it before adding any IP;
//   • any error fails open;
//   • login (/api/auth/*) is never under /api/admin, so authentication is unaffected.
// Reads the ip_whitelist table the admin UI writes to (60s cache). Supports exact
// IPs and "x.y.z.*" prefix wildcards.
let _ipwlCache = null, _ipwlCachedAt = 0;
async function adminIpWhitelistGuard(req, res, next) {
  try {
    if (process.env.IP_WHITELIST_ENFORCE !== 'true') return next();
    if (!req.path.startsWith('/api/admin')) return next();
    if (req.path.startsWith('/api/admin/ip-whitelist')) return next(); // always manageable
    if (!_ipwlCache || Date.now() - _ipwlCachedAt > 60000) {
      const [rows] = await pool.query('SELECT ip FROM ip_whitelist');
      _ipwlCache = rows.map(r => String(r.ip).trim()).filter(Boolean);
      _ipwlCachedAt = Date.now();
    }
    if (!_ipwlCache.length) return next(); // empty list = feature off (fail-open)
    const rawIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '');
    const clientIp = rawIp.split(',')[0].trim().replace(/^::ffff:/, '');
    const ok = _ipwlCache.some(e => e === clientIp || (e.endsWith('.*') && clientIp.startsWith(e.slice(0, -2) + '.')));
    if (ok) return next();
    logger.warn(`[ip-whitelist] BLOCKED admin request from ${clientIp} -> ${req.path}`);
    return res.status(403).json({ error: 'IP not whitelisted for admin access' });
  } catch (_) { return next(); } // fail-open — never hard-lock on error
}
app.use(adminIpWhitelistGuard);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES (admin only)
// ─────────────────────────────────────────────────────────────────────────────
app.use('/', authRouter);
app.use('/', publicRouter);
app.use('/', automationRouter);
app.use('/', campaignsRouter);
app.use('/', supportRouter);
app.use('/', adminUtilsRouter);
app.use('/', financeRouter);
app.use('/', analyticsRouter);
app.use('/', miscRouter);
app.use('/', notificationsRouter);
app.use('/', ordersRouter);
app.use('/', configRouter);
app.use('/', communityRouter);
app.use('/', inboxRouter);
app.use('/', daqqiRoundsRouter);
app.use('/', publicOrdersRouter);
app.use('/', imageProxyRouter);
app.use('/', certificatesRouter);
app.use('/', coreRouter);
app.use('/', adminRouter);
app.use('/', lmsAdminRouter);
app.use('/', paymentsRouter);
app.use('/', crmToolsRouter);
app.use('/', subscriberPayRouter);
app.use('/', paymentProofsRouter);
app.use('/', whatsappAdminRouter);
app.use('/', fbWebhooksRouter);
app.use('/', accountingRouter);
app.use('/', accountingErpRouter);
app.use('/', saasAdminRouter);
app.use('/', monitoringRouter);
app.use('/', adminMaintenanceRouter);
app.use('/', funnelRouter);
app.use('/', lmsRouter);
app.use('/', gsheetsRouter);
app.use('/', hrRouter);
app.use('/', require('./routes/docs')); // /api/docs (Swagger UI) + /api/openapi.json
app.use('/', paymentsAdminRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
// SPA catch-all — serve index.html with no-cache so browsers always get latest asset hashes
const _STATIC_DIR = process.env.STATIC_DIR || null;
if (_STATIC_DIR) {
  app.get('*', (_req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.sendFile(path.join(_STATIC_DIR, 'index.html'));
  });
} else {
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
}

// ── Global Express error handler ──────────────────────────────────────────────
// Catches errors thrown in routes or passed via next(err).
// Must be defined with 4 args AFTER all routes for Express to treat it as error middleware.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  _httpLogger.error('unhandled route error', {
    reqId: req.reqId, method: req.method, path: req.path, msg: err.message, stack: err.stack,
  });
  require('./lib/errorMonitor').captureException(err, { reqId: req.reqId, method: req.method, path: req.path });
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const server = app.listen(PORT, () => {
  server.keepAliveTimeout = 65000;
  server.headersTimeout   = 66000;
  // Expose server to SIGTERM handler for graceful shutdown
  // eslint-disable-next-line no-global-assign
  _httpServer = server;
  logger.info(`✅ Mahad API running on port ${PORT}`);
  logger.info(`   Live:  http://localhost:${PORT}/api/health/live`);
  logger.info(`   Ready: http://localhost:${PORT}/api/health`);

  // Load token blacklist from DB so revoked tokens survive restarts
  loadBlacklistFromDB().catch(() => {});

  // Load RBAC role overrides from settings + keep them refreshed (backend enforcement)
  require('./lib/rbacOverrides').startRbacRefresh();

  // Load editable WhatsApp message templates from settings + keep them refreshed
  require('./lib/messageTemplates').startTemplatesRefresh();

  // Automated daily DB backup (gzipped mysqldump, rotated) — production only.
  require('./lib/dbBackup').scheduleDbBackup();

  // Initialize optional error monitoring (Sentry — no-op unless SENTRY_DSN + package present)
  require('./lib/errorMonitor').initErrorMonitor();

  // Skip ALL background scheduling on non-production (local/dev) instances so a
  // dev box wired to the production DB never messages customers, imports leads,
  // or runs backups. Everything below this point is cron/worker/self-ping setup.
  if (!ENABLE_BACKGROUND_JOBS) {
    logger.info('[jobs] Background jobs DISABLED (non-production). Set ENABLE_LOCAL_JOBS=1 to enable.');
    return;
  }

  // ── Installment reminder Cron (runs once per hour, checks due in 3 days) ──
  const CRON_INTERVAL_MS = 60 * 60 * 1000; // every hour
  // Guard: track which (subscriberId+dueDate) pairs received a reminder today
  // Prevents duplicate sends on server restart or repeated cron runs within same day.
  const _installmentReminderSentToday = new Set(); // key: `${subId}:${dueDate}`
  let _installmentReminderLastReset = new Date().toISOString().slice(0, 10);
  async function installmentReminderCron() {
    try {
      // Reset daily tracking set at midnight
      const today = new Date().toISOString().slice(0, 10);
      if (today !== _installmentReminderLastReset) {
        _installmentReminderSentToday.clear();
        _installmentReminderLastReset = today;
      }

      // Find subscribers whose installment plan has a due_date = today+3 (stored in crm_json)
      // crm_json may contain: installmentPlans: [{dueDate:"2026-04-18", amount, paid, courseId}]
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 3);
      const target = targetDate.toISOString().slice(0, 10); // "YYYY-MM-DD"

      // Filter at DB level — only subscribers who have installment data (crm_json LIKE check)
      // Avoids loading entire subscribers table into memory on large datasets.
      const [subs] = await pool.query(
        "SELECT id, name, phone, crm_json FROM subscribers WHERE is_active=1 AND crm_json LIKE '%installmentPlans%' LIMIT 2000"
      );
      let sentCount = 0;
      for (const sub of subs) {
        const crm = tryJson(sub.crm_json, {});
        const plans = crm.installmentPlans || [];
        for (const plan of plans) {
          for (const entry of (plan.entries || [])) {
            const dueDate = (entry.dueDate || '').slice(0, 10);
            if (dueDate !== target) continue;
            if (entry.paidAt) continue; // already paid
            if (!sub.phone) continue;
            // Dedup: skip if already sent today for this entry
            const dedupeKey = `${sub.id}:${dueDate}:${plan.courseId || ''}`;
            if (_installmentReminderSentToday.has(dedupeKey)) continue;
            _installmentReminderSentToday.add(dedupeKey);
            const courseName = plan.courseTitle || 'قسط';
            const msg = renderTemplate('installment_reminder', { amount: entry.amount, currency: plan.currency || 'EGP', dueDate, courseName });
            try { await sendWhatsApp(sub.phone, msg); } catch (_) {}
            sentCount++;
            // Rate-limit WA sends to avoid being flagged as spam (max 1 msg/2s)
            if (sentCount % 5 === 0) await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
      if (sentCount) logger.info(`[Cron] installmentReminder: sent ${sentCount} WA reminders`);
    } catch (e) {
      logger.warn('[Cron] installmentReminderCron error:', e.message);
    }
  }
  // Enqueued onto the durable job queue (retryable) — startup + hourly.
  require('./lib/jobQueue').enqueue('installment_reminder', {}).catch(() => {});
  setInterval(() => require('./lib/jobQueue').enqueue('installment_reminder', {}).catch(() => {}), CRON_INTERVAL_MS);

  // ── Pending payment reminder (runs daily — reminds clients with pending > 3 days) ──
  async function pendingPaymentReminderCron() {
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const [pendingRows] = await pool.query(
        `SELECT p.id, p.amount, p.currency, p.date, s.name, s.phone
         FROM payments p JOIN subscribers s ON s.id = p.subscriber_id
         WHERE p.status = 'pending' AND p.date <= ? AND s.phone IS NOT NULL AND s.phone != ''
         LIMIT 50`,
        [threeDaysAgo]
      );
      for (const row of pendingRows) {
        const msg = renderTemplate('pending_payment_reminder', { amount: row.amount, currency: row.currency || 'EGP', date: String(row.date || '').slice(0,10) });
        await sendWhatsApp(row.phone, msg);
        // Avoid WhatsApp spam — short delay between messages
        await new Promise(r => setTimeout(r, 2000));
      }
      if (pendingRows.length) {
        logger.info(`[Cron] pendingPaymentReminder: sent ${pendingRows.length} reminders`);
        await createNotification('reminder', 'تذكيرات دفع مُرسلة', `تم إرسال ${pendingRows.length} تذكير للمدفوعات المعلّقة تلقائياً`, { count: pendingRows.length });
      }
    } catch (e) { logger.warn('[Cron] pendingPaymentReminderCron error:', e.message); }
  }
  // Daily, via the durable job queue (retryable). First enqueue after 2 min.
  setTimeout(() => {
    require('./lib/jobQueue').enqueue('pending_payment_reminder', {}).catch(() => {});
    setInterval(() => require('./lib/jobQueue').enqueue('pending_payment_reminder', {}).catch(() => {}), 24 * 60 * 60 * 1000);
  }, 2 * 60 * 1000);

  // ── FX Rates auto-refresh (runs on startup + every 24h) ──────────────────
  async function refreshFxRatesAuto() {
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/EGP', { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return;
      const data = await response.json();
      if (!data.rates?.SAR || !data.rates?.USD) return;
      const sar_to_egp = parseFloat((1 / data.rates.SAR).toFixed(4));
      const usd_to_egp = parseFloat((1 / data.rates.USD).toFixed(4));
      const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'content'");
      const existing = rows[0]?.value ? JSON.parse(rows[0].value) : {};
      const merged = { ...existing, 'exchange.sar_to_egp': String(sar_to_egp), 'exchange.usd_to_egp': String(usd_to_egp) };
      await pool.query(
        "INSERT INTO site_config (`key`, `value`) VALUES ('content', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
        [JSON.stringify(merged)]
      );
      cacheInvalidate('site_content');
      logger.info(`[FX] Auto-refreshed: SAR=${sar_to_egp}, USD=${usd_to_egp}`);
    } catch (e) { logger.warn('[FX] Auto-refresh failed:', e.message); }
  }
  // Run on startup (after 30s), then daily — enqueued onto the durable job queue
  // so the fetch is retried on transient failure (handled by the worker tick).
  setTimeout(() => {
    require('./lib/jobQueue').enqueue('fx_refresh', {}).catch(() => {});
    setInterval(() => require('./lib/jobQueue').enqueue('fx_refresh', {}).catch(() => {}), 24 * 60 * 60 * 1000);
  }, 30 * 1000);

  // ── Automation Engine: daily auto-run ─────────────────────────────────────
  // Runs all enabled workflows once per day automatically (no manual button needed).
  // First run is delayed 90s after startup to avoid DB load during boot.
  async function runAutomationEngine() {
    try {
      const [workflows] = await pool.query(
        `SELECT id, name, \`trigger\`, action, enabled, conditions_json AS conditions, action_config_json AS action_config,
         last_triggered_at, trigger_count, created_at
         FROM automation_workflows WHERE enabled = 1 ORDER BY created_at ASC`
      );
      if (!workflows.length) return;
      const todayStr = new Date().toISOString().slice(0, 10);
      let totalActions = 0;
      for (const wf of workflows) {
        const actionCfg = tryJson(wf.action_config, {});
        let matchedLeads = [];
        if (wf.trigger === 'no_contact_x_days') {
          const days = parseInt(actionCfg.days || '7');
          const [rows] = await pool.query(`SELECT l.id,l.name,l.phone,l.assigned_sales_name FROM leads l LEFT JOIN (SELECT lead_id,MAX(date) AS last_date FROM communications GROUP BY lead_id) c ON c.lead_id=l.id WHERE l.hidden=0 AND l.status NOT IN ('converted','lost','not_interested','no_answer_nowa','wrong_number') AND DATEDIFF(NOW(),COALESCE(c.last_date,l.last_follow_up,l.created_at))>=?`, [days]);
          matchedLeads = rows;
        } else if (wf.trigger === 'lead_score_threshold') {
          const threshold = parseInt(actionCfg.scoreThreshold || '70');
          const [rows] = await pool.query(`SELECT l.id,l.name,l.phone,l.assigned_sales_name,(CASE l.status WHEN 'interested_booking' THEN 100 WHEN 'interested_followup' THEN 80 WHEN 'interested' THEN 60 WHEN 'contacted' THEN 40 WHEN 'new' THEN 20 ELSE 10 END+CASE l.interest_level WHEN 'high' THEN 30 WHEN 'medium' THEN 15 ELSE 5 END) AS score FROM leads l WHERE l.hidden=0 AND l.status NOT IN ('converted','lost') HAVING score>=?`, [threshold]);
          matchedLeads = rows;
        } else if (wf.trigger === 'new_lead') {
          const sinceDays = parseInt(actionCfg.days || '1');
          const [rows] = await pool.query(`SELECT id,name,phone,assigned_sales_name FROM leads WHERE hidden=0 AND status='new' AND created_at>=DATE_SUB(NOW(),INTERVAL ? DAY)`, [sinceDays]);
          matchedLeads = rows;
        } else if (wf.trigger === 'subscription_expiring_soon') {
          const days = parseInt(actionCfg.days || '7');
          const [rows] = await pool.query(`SELECT s.id,s.name,s.email,s.phone,srh.expires_at FROM subscribers s LEFT JOIN subscriber_role_history srh ON srh.subscriber_id=s.id WHERE s.status='active' AND srh.expires_at IS NOT NULL AND DATEDIFF(srh.expires_at,NOW()) BETWEEN 0 AND ? GROUP BY s.id`, [days]);
          matchedLeads = rows;
        } else if (wf.trigger === 'subscriber_inactive_x_days') {
          const days = parseInt(actionCfg.days || '30');
          const [rows] = await pool.query(`SELECT s.id,s.name,s.email,s.phone,MAX(lp.completed_at) AS last_progress FROM subscribers s LEFT JOIN lecture_progress lp ON lp.subscriber_id=s.id WHERE s.status='active' GROUP BY s.id HAVING last_progress IS NULL OR DATEDIFF(NOW(),last_progress)>=?`, [days]);
          matchedLeads = rows;
        }
        let actionsRun = 0;
        for (const lead of matchedLeads) {
          if (wf.action === 'add_followup_reminder' && lead.id) {
            const newDate = new Date(); newDate.setDate(newDate.getDate() + parseInt(actionCfg.days || '3'));
            await pool.query('UPDATE leads SET next_follow_up_date=? WHERE id=? AND (next_follow_up_date IS NULL OR next_follow_up_date<NOW())', [newDate.toISOString().slice(0,10), lead.id]);
            actionsRun++;
          } else if (wf.action === 'update_lead_status' && actionCfg.status && lead.id) {
            await pool.query('UPDATE leads SET status=? WHERE id=?', [actionCfg.status, lead.id]);
            actionsRun++;
          } else if (wf.action === 'add_note' && lead.id) {
            const msg = (actionCfg.message || '').replace(/\{\{name\}\}/g, lead.name||'').replace(/\{\{phone\}\}/g, lead.phone||'');
            if (msg) { await pool.query(`INSERT IGNORE INTO communications (id,lead_id,type,date,notes,outcome) VALUES (?,?,'note',?,?,'auto')`, [`auto-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, lead.id, todayStr, `[أتوميشن: ${wf.name}] ${msg}`]); actionsRun++; }
          } else if (wf.action === 'notify_admin') {
            try { await pool.query(`INSERT IGNORE INTO automation_log (id,workflow_id,lead_id,action,triggered_at) VALUES (?,?,?,?,NOW())`, [uuidv4(), wf.id, lead.id||null, wf.action]); } catch(_){}
            actionsRun++;
          }
        }
        if (actionsRun > 0) {
          await pool.query('UPDATE automation_workflows SET trigger_count=trigger_count+?,last_triggered_at=? WHERE id=?', [actionsRun, new Date().toISOString(), wf.id]);
        }
        totalActions += actionsRun;
      }
      logger.info(`[auto-cron] Automation engine ran: ${workflows.length} workflows, ${totalActions} actions executed`);
    } catch (e) {
      logger.warn('[auto-cron] Automation engine error:', e.message);
    }
  }
  // First run delayed 90s after boot, then every 24 hours
  setTimeout(() => {
    runAutomationEngine();
    setInterval(runAutomationEngine, 24 * 60 * 60 * 1000);
  }, 90 * 1000);

  // ── Daqqi Session Reminders (24h + 2h before session) ────────────────────
  // Sends WhatsApp reminder to daqqi clients before their session.
  async function daqqiSessionReminderCron() {
    try {
      const now = new Date();
      // 24h window: 23–25h ahead. 2h window: 1h50m–2h10m ahead.
      const windows = [
        [now.getTime() + 23 * 3600e3, now.getTime() + 25 * 3600e3, '24 ساعة'],
        [now.getTime() + 110 * 60e3,  now.getTime() + 130 * 60e3,  'ساعتين'],
      ];

      // Compute next-session in JS so postponed weeks shift the schedule correctly:
      // each postponement pushes the whole round one week (admin UI semantics:
      // lecture N happens at start_date + (N-1 + postponedCount) weeks).
      const [rounds] = await pool.query(`
        SELECT dr.id, dr.code, dr.time_slot, dr.start_date, dr.current_lecture,
               dr.postponed_weeks_json, c.title AS course_title
        FROM daqqi_rounds dr
        JOIN courses c ON c.id = dr.course_id
        WHERE dr.status = 'ACTIVE'
      `);
      const mondayOf = (d) => {
        const m = new Date(d);
        const day = m.getDay();
        m.setDate(m.getDate() - (day === 0 ? 6 : day - 1));
        return m.toISOString().slice(0, 10);
      };
      for (const [wFrom, wTo, label] of windows) {
        const dueRounds = rounds.filter(r => {
          if (!r.start_date) return false;
          let postponed = [];
          try { postponed = JSON.parse(r.postponed_weeks_json || '[]') || []; } catch { postponed = []; }
          const next = new Date(new Date(r.start_date).getTime()
            + (Number(r.current_lecture || 0) + postponed.length) * 7 * 86400e3);
          // Defensive: never remind for a week explicitly marked postponed
          if (postponed.includes(mondayOf(next))) return false;
          r._nextSession = next;
          return next.getTime() >= wFrom && next.getTime() <= wTo;
        });
        if (!dueRounds.length) continue;

        const [attendees] = await pool.query(`
          SELECT da.round_id, s.phone, s.name
          FROM daqqi_attendees da JOIN subscribers s ON s.id = da.subscriber_id
          WHERE da.round_id IN (?)
        `, [dueRounds.map(r => r.id)]);

        let sent = 0;
        for (const r of dueRounds) {
          const sessionDate = r._nextSession.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          const timeLabel = r.time_slot === 'MORNING' ? 'الصباح' : r.time_slot === 'NOON' ? 'الظهيرة' : 'المساء';
          for (const a of attendees.filter(x => x.round_id === r.id)) {
            if (!a.phone) continue;
            const msg = renderTemplate('daqqi_session_reminder', { name: a.name, courseTitle: r.course_title, sessionDate, timeLabel });
            await sendWhatsApp(a.phone, msg).catch(() => {});
            sent++;
          }
        }
        if (sent) logger.info(`[Cron] daqqiReminder (${label}): sent ${sent} reminders`);
      }
    } catch (e) { logger.warn('[Cron] daqqiSessionReminderCron error:', e.message); }
  }
  // Run every hour
  setTimeout(() => {
    daqqiSessionReminderCron();
    setInterval(daqqiSessionReminderCron, 60 * 60 * 1000);
  }, 3 * 60 * 1000);

  // ── Lead Retargeting: auto-message unconverted leads after 30 days ─────────
  async function leadRetargetingCron() {
    try {
      const [leads] = await pool.query(`
        SELECT l.id, l.name, l.phone, l.email
        FROM leads l
        WHERE l.hidden = 0
          AND l.status NOT IN ('converted','lost','not_interested','no_answer')
          AND (l.retargeting_sent_at IS NULL OR l.retargeting_sent_at < DATE_SUB(NOW(), INTERVAL 30 DAY))
          AND l.created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND l.phone IS NOT NULL AND l.phone != ''
        LIMIT 50
      `);
      if (!leads.length) return;
      let sent = 0;
      for (const lead of leads) {
        const msg = renderTemplate('lead_retargeting', { name: lead.name });
        const res = await sendWhatsApp(lead.phone, msg).catch(() => ({ ok: false }));
        if (res.ok) {
          await pool.query(
            'UPDATE leads SET retargeting_sent_at=NOW() WHERE id=?',
            [lead.id]
          ).catch(() => {});
          await pool.query(
            `INSERT IGNORE INTO retargeting_log (id, lead_id, channel, template, status, sent_at)
             VALUES (UUID(), ?, 'WHATSAPP', 'reactivation_30d', 'SENT', NOW())`,
            [lead.id]
          ).catch(() => {});
          sent++;
        }
      }
      if (sent) logger.info(`[Cron] leadRetargeting: sent ${sent} reactivation messages`);
    } catch (e) { logger.warn('[Cron] leadRetargetingCron error:', e.message); }
  }
  // Run daily (first run after 5min)
  setTimeout(() => {
    leadRetargetingCron();
    setInterval(leadRetargetingCron, 24 * 60 * 60 * 1000);
  }, 5 * 60 * 1000);

  // ── Auto Daily Backup ─────────────────────────────────────────────────────
  // Dumps MySQL DB to /tmp/backups and keeps last 7 days
  async function autoDailyBackup() {
    const { execSync, exec } = require('child_process');
    const fs = require('fs');
    const bkDir = '/tmp/mahad_backups';
    try {
      if (!fs.existsSync(bkDir)) fs.mkdirSync(bkDir, { recursive: true });
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbUser = process.env.DB_USER || 'root';
      const dbPass = process.env.DB_PASS || '';
      const dbName = process.env.DB_NAME || '';
      if (!dbName) { logger.warn('[Backup] DB_NAME not set — skipping backup'); return; }
      const filename = `backup_${new Date().toISOString().slice(0,10)}.sql.gz`;
      const filepath = `${bkDir}/${filename}`;
      const cmd = `mysqldump -h${dbHost} -u${dbUser} -p'${dbPass}' --single-transaction --quick ${dbName} | gzip > ${filepath}`;
      execSync(cmd, { timeout: 120000, shell: '/bin/bash' });
      const size = fs.statSync(filepath).size;
      // Log to DB
      await pool.query(
        `INSERT IGNORE INTO backup_logs (id, filename, size_bytes, status) VALUES (UUID(), ?, ?, 'SUCCESS')`,
        [filename, size]
      ).catch(() => {});
      logger.info(`[Backup] Daily backup done: ${filename} (${Math.round(size/1024)}KB)`);
      // Cleanup backups older than 7 days
      exec(`find ${bkDir} -name 'backup_*.sql.gz' -mtime +7 -delete`, () => {});
    } catch (e) {
      logger.warn('[Backup] autoDailyBackup error:', e.message);
      await pool.query(
        `INSERT IGNORE INTO backup_logs (id, filename, size_bytes, status, error) VALUES (UUID(), 'backup_failed', 0, 'FAILED', ?)`,
        [e.message?.slice(0, 500) || 'unknown']
      ).catch(() => {});
    }
  }
  // Run once per day at 2am (first run after server start with 10min delay)
  setTimeout(() => {
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(2, 0, 0, 0);
    if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
    const msToFirst = nextRun - now;
    setTimeout(() => {
      autoDailyBackup();
      setInterval(autoDailyBackup, 24 * 60 * 60 * 1000);
    }, msToFirst);
    logger.info(`[Backup] Scheduled daily backup at 02:00 (in ${Math.round(msToFirst / 60000)}min)`);
  }, 10 * 60 * 1000);

  // ── Waitlist Auto-Notify: when Daqqi round opens a spot ──────────────────
  // Checks every 30min if any waitlisted subscriber should be notified
  async function waitlistNotifyCron() {
    try {
      // Find courses where capacity > enrolled AND has waitlist entries with notify_sent=0
      const [waitlisted] = await pool.query(`
        SELECT cw.id, cw.subscriber_id, cw.course_id, cw.position,
               s.name, s.phone, c.title AS course_title
        FROM course_waitlist cw
        JOIN subscribers s ON s.id = cw.subscriber_id
        JOIN courses c ON c.id = cw.course_id
        WHERE cw.notify_sent = 0
          AND cw.status = 'waiting'
          AND c.capacity IS NOT NULL
          AND (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = cw.course_id) < c.capacity
        ORDER BY cw.position ASC
        LIMIT 20
      `).catch(() => [[]]);

      for (const w of waitlisted) {
        if (!w.phone) continue;
        const msg = `أهلاً ${w.name} 🎉\nيسعدنا إبلاغك بأن مقعداً أصبح متاحاً في كورس:\n📚 ${w.course_title}\n\nيرجى التواصل معنا خلال 48 ساعة لتأكيد حجزك قبل انتقاله للتالي في القائمة ⏳\n— مهاد نفسي 💚`;
        await sendWhatsApp(w.phone, msg).catch(() => {});
        await pool.query('UPDATE course_waitlist SET notify_sent=1, notified_at=NOW() WHERE id=?', [w.id]).catch(() => {});
      }
      if (waitlisted.length) logger.info(`[Cron] waitlistNotify: notified ${waitlisted.length} subscribers`);
    } catch (e) { logger.warn('[Cron] waitlistNotifyCron error:', e.message); }
  }
  // Run every 30 minutes
  setTimeout(() => {
    waitlistNotifyCron();
    setInterval(waitlistNotifyCron, 30 * 60 * 1000);
  }, 7 * 60 * 1000);

  // ── Outbox + job-queue drain worker (Top20 #7/#8) ─────────────────────────
  // Durable delivery for email/whatsapp + retryable background jobs. No-op while
  // the queues are empty, so it is safe to run unconditionally every minute.
  const _outbox = require('./lib/outbox');
  const _jobQueue = require('./lib/jobQueue');
  const _email = require('./lib/email');
  // Cron jobs migrated to the durable, retryable queue. Register handlers here.
  const _jobHandlers = {
    fx_refresh: async () => { await refreshFxRatesAuto(); },
    installment_reminder: async () => { await installmentReminderCron(); },
    pending_payment_reminder: async () => { await pendingPaymentReminderCron(); },
  };
  async function backgroundWorkerTick() {
    try {
      await _outbox.drain({
        email:    ({ recipient, subject, body, html }) => _email.sendEmail(recipient, subject, html || body || ''),
        whatsapp: ({ recipient, message }) => sendWhatsApp(recipient, message || ''),
      });
      await _jobQueue.processBatch(_jobHandlers, `srv-${process.pid}`);
    } catch (e) { logger.warn('[worker] tick error:', e.message); }
  }
  setInterval(backgroundWorkerTick, 60 * 1000);

  // ── Lifecycle daily scan (re-engage stalled learners, etc.) ───────────────
  const _lifecycle = require('./lib/lifecycle');
  async function lifecycleScanTick() { try { await _lifecycle.scanScheduled(); } catch (e) { logger.warn('[lifecycle] scan tick error:', e.message); } }
  // Hourly scan keeps the checkout-abandoned nudge responsive; all triggers are
  // deduped (per-week for stalled/abandoned, once-ever for checkout) so it can't spam.
  setTimeout(() => { lifecycleScanTick(); setInterval(lifecycleScanTick, 60 * 60 * 1000); }, 10 * 60 * 1000);

  // ── Self-ping every 10-13 minutes (randomized) ────────────────────────────
  // Hostinger kills Node.js processes on :00/:30 boundaries via resource sweep.
  // Randomized interval avoids syncing with the scheduler's fixed cron times.
  function scheduleSelfPing() {
    const jitter = Math.floor(Math.random() * 3 * 60 * 1000); // 0–3 min random
    const interval = 10 * 60 * 1000 + jitter; // 10–13 minutes
    setTimeout(() => {
      const http = require('http');
      const req = http.get(`http://127.0.0.1:${PORT}/api/health`, { timeout: 5000 }, res => {
        res.resume();
      });
      req.on('error', () => {});
      req.end();
      scheduleSelfPing(); // schedule next ping with new random interval
    }, interval);
  }
  scheduleSelfPing();
});

